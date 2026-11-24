const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const db = require('../db/schema');
const { currentTimestamp } = require('../db/dialect');
const { invalidateAuthStatus } = require('../cache');
const {
  createWalletFromMnemonic,
  deriveKeypairFromMnemonic,
  getBalance,
  mergeAccount,
} = require('../utils/stellar');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requireStepUp2FA = require('../middleware/requireStepUp2FA');
const { err } = require('../middleware/error');
const logger = require('../logger');
const { createPerIpRateLimiter } = require('../middleware/rateLimitPerUser');
const { csrfTokenHandler, generateCsrfToken } = require('../middleware/csrf');
const { encrypt } = require('../utils/crypto');
const { issueVerificationToken } = require('../services/emailVerificationService');
const { sendVerificationEmail } = require('../services/emailService');

const loginRateLimit = createPerIpRateLimiter(
  parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '5', 10),
  60 * 1000
);
const registerRateLimit = createPerIpRateLimiter(
  parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '3', 10),
  60 * 1000
);

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

// ── Mnemonic encryption helpers ──────────────────────────────────────────────
// We derive a 32-byte key from the user's password using scrypt, then
// AES-256-GCM encrypt the mnemonic. The salt + iv + authTag + ciphertext are
// all stored together as a single hex string so the column is self-contained.

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 32 };

async function encryptMnemonic(mnemonic, password) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    crypto.scrypt(
      password,
      salt,
      SCRYPT_PARAMS.dkLen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (e, k) => (e ? reject(e) : resolve(k))
    )
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: salt(16) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([salt, iv, tag, ct]).toString('hex');
}

async function decryptMnemonic(encryptedHex, password) {
  const buf = Buffer.from(encryptedHex, 'hex');
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const ct = buf.subarray(44);
  const key = await new Promise((resolve, reject) =>
    crypto.scrypt(
      password,
      salt,
      SCRYPT_PARAMS.dkLen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (e, k) => (e ? reject(e) : resolve(k))
    )
  );
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return decipher.update(ct) + decipher.final('utf8');
  } catch {
    return null; // wrong password → auth tag mismatch
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: REFRESH_TOKEN_TTL,
  path: '/api/v1/auth',
};

function signAccessToken(payload) {
  return jwt.sign({ ...payload, typ: 'access' }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || (process.env.NODE_ENV === 'production' && Buffer.byteLength(secret, 'utf8') < 32)) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes in production');
  }
  return secret;
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function storeRefreshToken(userId, rawToken, familyId = null) {
  const hash = hashToken(rawToken);
  const family = familyId || hash; // new family starts with its own hash as ID
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL).toISOString();
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id, used, revoked_at, replaced_by) VALUES ($1, $2, $3, $4, 0, NULL, NULL)',
    [userId, hash, expiresAt, family]
  );
  return family;
}

// Returns { newToken, familyId } on success, { reuse: true, userId, familyId } on replay, null on expired/not-found.
async function rotateRefreshToken(userId, oldRawToken) {
  const oldHash = hashToken(oldRawToken);
  const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2', [oldHash, userId]);
  const existing = rows[0];
  if (!existing) return null;
  if (existing.revoked_at || existing.replaced_by || existing.used) {
    await db.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = $1 AND family_id = $2', [userId, existing.family_id]);
    return { reuse: true, userId, familyId: existing.family_id };
  }
  if (new Date(existing.expires_at) < new Date()) {
    await db.query('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1', [existing.id]);
    return null;
  }
  const newRawToken = generateRefreshToken();
  const newHash = hashToken(newRawToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL).toISOString();
  const update = await db.query(`UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, used = 1 WHERE id = $1 AND revoked_at IS NULL AND replaced_by IS NULL AND COALESCE(used, 0) = 0`, [existing.id]);
  if (update.rowCount === 0) {
    await db.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = $1 AND family_id = $2', [userId, existing.family_id]);
    return { reuse: true, userId, familyId: existing.family_id };
  }
  const inserted = await db.query(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id, used, revoked_at, replaced_by) VALUES ($1, $2, $3, $4, 0, NULL, NULL) RETURNING id`, [userId, newHash, newExpiresAt, existing.family_id]);
  await db.query('UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2', [inserted.rows?.[0]?.id || null, existing.id]);
  return { newToken: newRawToken, familyId: existing.family_id };
}
/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and session management
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [farmer, buyer] }
 *               ref: { type: string, description: Referral code }
 *     responses:
 *       200:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: JWT access token }
 *                 user: { $ref: '#/components/schemas/User' }
 *       409:
 *         description: Email already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// POST /api/auth/register
router.post('/register', registerRateLimit, validate.register, async (req, res) => {
  const { name, email, password, role, ref } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 12);
    const wallet = createWalletFromMnemonic();
    const encryptedMnemonic = await encryptMnemonic(wallet.mnemonic, password);
    const encryptedSecretKey = await encrypt(wallet.secretKey);
    const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    let referredBy = null;
    if (ref) {
      const { rows } = await db.query('SELECT id FROM users WHERE referral_code = $1', [ref]);
      if (rows[0]) referredBy = rows[0].id;
    }

    const { rows } = await db.query(
      'INSERT INTO users (name, email, password, role, stellar_public_key, stellar_secret_key, stellar_mnemonic, referral_code, referred_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [
        name,
        email,
        hashed,
        role,
        wallet.publicKey,
        encryptedSecretKey,
        encryptedMnemonic,
        referralCode,
        referredBy,
      ]
    );
    const userId = rows[0].id;
    const verificationToken = await issueVerificationToken(userId);
    try {
      await sendVerificationEmail(email, verificationToken);
    } catch (emailError) {
      logger.error('registration verification email failed', {
        userId,
        error: emailError.message,
        stack: emailError.stack,
      });
    }
    const accessToken = signAccessToken({ id: userId, role });
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(userId, rawRefresh);

    res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
    res.json({
      token: accessToken,
      user: { id: userId, name, email, role, publicKey: wallet.publicKey, referralCode },
    });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.code === '23505')
      return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: JWT access token }
 *                 user: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// POST /api/auth/login
router.post('/login', loginRateLimit, validate.login, async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query(
    'SELECT id, name, email, password, role, stellar_public_key FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  const { rows: twoFactorRows } = await db.query('SELECT enabled FROM user_2fa_settings WHERE user_id = $1', [user.id]);
  if (twoFactorRows[0]?.enabled === 1 || twoFactorRows[0]?.enabled === true) {
    const mfaToken = jwt.sign({ id: user.id, scope: 'mfa' }, getJwtSecret(), { expiresIn: '5m' });
    return res.json({ mfa_required: true, mfa_token: mfaToken });
  }
  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const rawRefresh = generateRefreshToken();
  await storeRefreshToken(user.id, rawRefresh);

  // #836: set the refresh token before rotating the CSRF cookie so the refresh token
  // remains the first Set-Cookie entry in the response and clients can persist it reliably.
  res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);

  // #836: Rotate CSRF token on every login to prevent token-fixation attacks.
  generateCsrfToken(res);
  res.json({
    token: accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      publicKey: user.stellar_public_key,
    },
  });
});

/**
 * GET /api/auth/csrf-token
 * Returns a fresh CSRF token for SPA initialization. (#836)
 * The token is also set as a readable cookie for the double-submit cookie pattern.
 */
router.get('/csrf-token', csrfTokenHandler);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using httpOnly refresh token cookie
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *       401:
 *         description: Invalid or expired refresh token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return res.status(401).json({ error: 'No refresh token' });

  const tokenHash = hashToken(rawToken);
  const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [
    tokenHash,
  ]);
  const stored = rows[0];
  if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });

  if (new Date(stored.expires_at) < new Date()) {
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [stored.id]);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const result = await rotateRefreshToken(stored.user_id, rawToken);
  if (!result) return res.status(401).json({ error: 'Invalid refresh token' });

  if (result.reuse) {
    logger.warn('refresh_token_reuse_detected', {
      event: 'token_reuse_detected',
      userId: result.userId,
      familyId: result.familyId,
    });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return res.status(401).json({ error: 'Token reuse detected', code: 'token_reuse_detected' });
  }

  const { rows: userRows } = await db.query('SELECT id, role FROM users WHERE id = $1', [
    stored.user_id,
  ]);
  const user = userRows[0];
  if (!user) return res.status(401).json({ error: 'User not found' });

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  res.cookie('refreshToken', result.newToken, COOKIE_OPTIONS);
  res.json({ token: accessToken });
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, email, role, stellar_public_key AS publicKey, referral_code AS referralCode FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return err(res, 404, 'User not found', 'not_found');
  res.json(rows[0]);
});

// GET /api/auth/stream-token — mints a short-lived, stream-scoped token for
// SSE connections (EventSource can't send an Authorization header, so the
// long-lived access token must never be put in the URL — see #1170).
router.get('/stream-token', auth, (req, res) => {
  const token = jwt.sign(
    { id: req.user.id, scope: 'stream' },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '60s' }
  );
  res.json({ token, expiresIn: 60 });
});

// PATCH /api/auth/me — update general account fields (name/email)
router.patch('/me', auth, requireStepUp2FA, async (req, res) => {
  const { name, email } = req.body || {};
  if (!name && !email) return err(res, 400, 'Nothing to update', 'validation_error');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err(res, 400, 'Invalid email', 'validation_error');
  }
  try {
    const { rows } = await db.query(
      `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email)
       WHERE id = $3
       RETURNING id, name, email, role, stellar_public_key AS "publicKey", referral_code AS "referralCode"`,
      [name || null, email || null, req.user.id]
    );
    if (!rows[0]) return err(res, 404, 'User not found', 'not_found');
    res.json(rows[0]);
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.code === '23505')
      return err(res, 409, 'Email already exists', 'conflict');
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout and invalidate refresh token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 */
// POST /api/auth/logout
router.patch('/password', auth, requireStepUp2FA, validate.changePassword, async (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body;

  const { rows } = await db.query('SELECT id, password FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user) return err(res, 404, 'User not found', 'user_not_found');

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return err(res, 401, 'Current password is incorrect', 'invalid_current_password');

  const hashed = await bcrypt.hash(newPassword, 12);
  await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (rawToken) {
    const hash = hashToken(rawToken);
    await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
  }
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  res.json({ ok: true });
});

// POST /api/auth/deactivate — soft-deactivate account (GDPR: PII anonymized after 30 days)
router.post('/deactivate', auth, async (req, res) => {
  const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return err(res, 404, 'User not found', 'not_found');

  await db.query('UPDATE users SET active = 0, deactivated_at = CURRENT_TIMESTAMP WHERE id = $1', [
    req.user.id,
  ]);
  await invalidateAuthStatus(req.user.id);

  // Revoke all sessions
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  res.json({
    success: true,
    message: 'Account deactivated. Your data will be anonymized after 30 days.',
  });
});

async function exportAccountData(userId) {
  const [profile, addresses, orders, reviews, favorites] = await Promise.all([
    db.query(
      `SELECT id, name, email, role, stellar_public_key, active, created_at, deactivated_at, anonymized_at
       FROM users WHERE id = $1`,
      [userId]
    ),
    db.query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY id', [userId]),
    db.query(
      `SELECT o.id, o.product_id, o.quantity, o.total_price, o.status, o.stellar_tx_hash, o.created_at,
              p.name AS product_name
       FROM orders o LEFT JOIN products p ON p.id = o.product_id
       WHERE o.buyer_id = $1 ORDER BY o.created_at DESC`,
      [userId]
    ),
    db.query(
      `SELECT id, order_id, product_id, rating, comment, created_at
       FROM reviews WHERE buyer_id = $1 ORDER BY created_at DESC`,
      [userId]
    ),
    db.query('SELECT * FROM favorites WHERE buyer_id = $1 ORDER BY id', [userId]),
  ]);
  if (!profile.rows[0]) return null;
  return {
    exportedAt: new Date().toISOString(),
    profile: profile.rows[0],
    addresses: addresses.rows,
    orders: orders.rows,
    reviews: reviews.rows,
    favorites: favorites.rows,
  };
}

// GET /api/auth/export and /api/auth/account/export — self-service GDPR export
const accountExportHandler = async (req, res) => {
  const data = await exportAccountData(req.user.id);
  if (!data) return err(res, 404, 'User not found', 'not_found');
  res.setHeader('Content-Disposition', `attachment; filename="farmers-marketplace-data-${req.user.id}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(data);
};
router.get('/export', auth, accountExportHandler);
router.get('/account/export', auth, accountExportHandler);

// POST /api/auth/account/deletion-request — revoke sessions and schedule anonymization
router.post('/account/deletion-request', auth, async (req, res) => {
  const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return err(res, 404, 'User not found', 'not_found');

  await db.query(
    'UPDATE users SET active = 0, deactivated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [req.user.id]
  );
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
  res.clearCookie('refreshToken', { path: '/api/auth' });
  return res.status(202).json({
    success: true,
    message: 'Deletion requested. Personal data will be anonymized after the retention period.',
  });
});

// DELETE /api/auth/account — self-service account deletion with optional wallet sweep
router.delete('/account', auth, requireStepUp2FA, async (req, res) => {
  const { password, sweep_to } = req.body;

  // Require password confirmation
  if (!password) {
    return err(res, 400, 'Password confirmation required', 'password_required');
  }

  const { rows } = await db.query(
    'SELECT id, password, stellar_public_key, stellar_secret_key FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = rows[0];
  if (!user) return err(res, 404, 'User not found', 'not_found');

  // Verify password
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return err(res, 401, 'Incorrect password', 'invalid_password');
  }

  // Check for open obligations that block deletion
  const openChecks = [
    {
      reason: 'open_escrows',
      sql: `SELECT COUNT(*) AS c FROM escrows
            WHERE (farmer_id = $1 OR buyer_id = $1)
              AND status IN ('pending', 'funded', 'active')`,
    },
    {
      reason: 'open_disputes',
      sql: `SELECT COUNT(*) AS c FROM disputes
            WHERE (claimant_id = $1 OR respondent_id = $1)
              AND status IN ('open', 'under_review')`,
    },
    {
      reason: 'active_subscriptions',
      sql: `SELECT COUNT(*) AS c FROM subscriptions
            WHERE (farmer_id = $1 OR buyer_id = $1)
              AND status = 'active'`,
    },
  ];

  for (const check of openChecks) {
    try {
      const { rows: countRows } = await db.query(check.sql, [req.user.id]);
      const count = Number(countRows[0]?.c || 0);
      if (count > 0) {
        return err(
          res,
          409,
          `Cannot delete account: you have ${check.reason.replace('_', ' ')}. Please resolve them first.`,
          check.reason
        );
      }
    } catch (e) {
      // Table might not exist in all deployments — log but don't block
      logger.warn(`[account-delete] ${check.reason} check failed`, {
        userId: req.user.id,
        error: e.message,
      });
    }
  }

  let txHash = null;

  // Sweep funds to user-supplied address if provided
  if (sweep_to) {
    if (!/^G[A-Z0-9]{55}$/.test(sweep_to)) {
      return err(res, 400, 'Invalid sweep_to address format', 'invalid_sweep_address');
    }

    try {
      const { decrypt } = require('../utils/crypto');
      const secretKey = await decrypt(user.stellar_secret_key);
      const { mergeAccount } = require('../utils/stellar');
      
      txHash = await mergeAccount({
        sourceSecret: secretKey,
        destination: sweep_to,
      });

      logger.info('[account-delete] Wallet merged successfully', {
        userId: req.user.id,
        destination: sweep_to,
        txHash,
      });
    } catch (e) {
      logger.error('[account-delete] Wallet merge failed', {
        userId: req.user.id,
        error: e.message,
      });
      return err(
        res,
        500,
        `Failed to merge wallet: ${e.message}. Your account was not deleted.`,
        'merge_failed'
      );
    }
  } else {
    // Warn if balance exists
    try {
      const balance = await getBalance(user.stellar_public_key);
      if (balance > 0.5) {
        return res.status(409).json({
          success: false,
          code: 'balance_warning',
          message: `Your wallet holds ${balance.toFixed(4)} XLM. Provide sweep_to to transfer funds, or they will be lost.`,
          balance,
          publicKey: user.stellar_public_key,
        });
      }
    } catch (e) {
      logger.warn('[account-delete] Balance check failed', {
        userId: req.user.id,
        error: e.message,
      });
    }
  }

  // Deactivate account and schedule anonymization
  await db.query(
    'UPDATE users SET active = 0, deactivated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [req.user.id]
  );

  // Store merge transaction hash in audit log if sweep happened
  if (txHash) {
    try {
      await db.query(
        `INSERT INTO audit_log (user_id, event, details, created_at)
         VALUES ($1, 'account_deletion_sweep', $2, CURRENT_TIMESTAMP)`,
        [req.user.id, JSON.stringify({ sweep_to, txHash })]
      );
    } catch (e) {
      // Audit log is best-effort
      logger.warn('[account-delete] Failed to log sweep tx', {
        userId: req.user.id,
        error: e.message,
      });
    }
  }

  // Revoke all sessions
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
  await invalidateAuthStatus(req.user.id);
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });

  res.json({
    success: true,
    message: txHash
      ? `Account deactivated. Wallet merged to ${sweep_to}. Personal data will be anonymized after 30 days.`
      : 'Account deactivated. Personal data will be anonymized after 30 days.',
    txHash,
  });
});

/**
 * POST /api/auth/seed-phrase  (password confirmation required)
 * Returns the decrypted mnemonic ONCE per request. Never cached.
 */
router.post('/seed-phrase', auth, requireStepUp2FA, validate.confirmPassword, async (req, res) => {
  const { password } = req.body;
  const { rows } = await db.query('SELECT password, stellar_mnemonic FROM users WHERE id = $1', [
    req.user.id,
  ]);
  const user = rows[0];
  if (!user) return err(res, 404, 'User not found', 'not_found');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return err(res, 401, 'Incorrect password', 'invalid_credentials');

  // Revealing the seed phrase also requires a TOTP code when 2FA is enabled.
  const { rows: tfaRows } = await db.query(
    'SELECT totp_secret, enabled FROM user_2fa_settings WHERE user_id = $1',
    [req.user.id]
  );
  const tfa = tfaRows[0];
  if (tfa && tfa.enabled === 1) {
    const code = String(req.body.totp || '').trim();
    if (!code) return err(res, 401, 'Two-factor code required', 'totp_required');
    const ok = speakeasy.totp.verify({
      secret: tfa.totp_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!ok) return err(res, 401, 'Invalid two-factor code', 'invalid_code');
  }

  if (!user.stellar_mnemonic) {
    return err(
      res,
      404,
      'No seed phrase found for this account. It may have been created before this feature was added.',
      'no_seed_phrase'
    );
  }

  const mnemonic = await decryptMnemonic(user.stellar_mnemonic, password);
  if (!mnemonic) return err(res, 500, 'Failed to decrypt seed phrase', 'decrypt_error');

  // Never log or cache — return once
  res.setHeader('Cache-Control', 'no-store');
  res.json({ mnemonic });
});

/**
 * POST /api/auth/recover
 * Recover wallet access from a BIP39 seed phrase.
 * Body: { email, password, mnemonic }
 * - Verifies the derived public key matches the stored one
 * - Issues a new session (access + refresh tokens)
 */
router.post('/recover', validate.recover, async (req, res) => {
  const { email, password, mnemonic } = req.body;

  const { rows } = await db.query(
    'SELECT id, name, email, password, role, stellar_public_key, stellar_mnemonic FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  // Derive keypair from the provided mnemonic and verify it matches
  let derived;
  try {
    derived = deriveKeypairFromMnemonic(mnemonic.trim());
  } catch {
    return err(res, 400, 'Invalid mnemonic phrase', 'invalid_mnemonic');
  }

  if (derived.publicKey !== user.stellar_public_key) {
    return err(res, 401, 'Seed phrase does not match this account', 'mnemonic_mismatch');
  }

  // Re-encrypt mnemonic with current password (in case it was missing)
  if (!user.stellar_mnemonic) {
    const encryptedMnemonic = await encryptMnemonic(mnemonic.trim(), password);
    await db.query('UPDATE users SET stellar_mnemonic = $1 WHERE id = $2', [
      encryptedMnemonic,
      user.id,
    ]);
  }

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const rawRefresh = generateRefreshToken();
  await storeRefreshToken(user.id, rawRefresh);

  res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
  res.json({
    token: accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      publicKey: user.stellar_public_key,
    },
  });
});

/** Complete password login with a TOTP or one-time recovery code. */
router.post('/2fa/login', async (req, res) => {
  try {
    const payload = jwt.verify(req.body?.mfa_token || '', getJwtSecret());
    if (payload.scope !== 'mfa') return err(res, 401, 'Invalid MFA token', 'invalid_mfa_token');
    const code = String(req.body?.code || '').trim();
    const { rows } = await db.query('SELECT * FROM user_2fa_settings WHERE user_id = $1 AND enabled = 1', [payload.id]);
    const settings = rows[0];
    if (!settings) return err(res, 401, '2FA is not enabled', 'invalid_mfa');
    let verified = false;
    const secret = settings.totp_secret || settings.secret;
    if (/^\d{6}$/.test(code)) {
      verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 2 });
    } else if (code) {
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      const consumed = await db.query('UPDATE two_factor_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [payload.id, hash]);
      if (consumed.rowCount > 0) verified = true;
      else {
        const codes = JSON.parse(settings.backup_codes || '[]');
        const position = codes.indexOf(hash);
        if (position >= 0) {
          codes.splice(position, 1);
          await db.query('UPDATE user_2fa_settings SET backup_codes = $1 WHERE user_id = $2', [JSON.stringify(codes), payload.id]);
          verified = true;
        }
      }
    }
    if (!verified) return err(res, 401, 'Invalid or already-used 2FA code', 'invalid_mfa_code');
    const { rows: users } = await db.query('SELECT id, name, email, role, stellar_public_key FROM users WHERE id = $1', [payload.id]);
    const user = users[0];
    if (!user) return err(res, 401, 'User not found', 'user_not_found');
    const accessToken = signAccessToken({ id: user.id, role: user.role });
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);
    res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
    return res.json({ token: accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, publicKey: user.stellar_public_key } });
  } catch (e) {
    if (e.name === 'TokenExpiredError' || e.name === 'JsonWebTokenError') return err(res, 401, 'Invalid MFA token', 'invalid_mfa_token');
    logger.error('2fa_login_error', { error: e.message });
    return res.status(500).json({ error: 'Failed to complete 2FA login' });
  }
});
/**
 * POST /api/auth/2fa/setup
 * Initiate 2FA setup: generate TOTP secret and return QR code
 */
router.post('/2fa/setup', auth, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Farmers Marketplace (${req.user.id})`,
      issuer: 'Farmers Marketplace',
      length: 32,
    });

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCode,
      backupCodes: generateBackupCodes(10),
    });
  } catch (e) {
    logger.error('2fa_setup_error', { error: e.message });
    res.status(500).json({ error: 'Failed to generate 2FA setup' });
  }
});

/**
 * POST /api/auth/2fa/verify
 * Verify TOTP code and enable 2FA
 * Body: { secret, code, backupCodes }
 */
router.post('/2fa/verify', auth, validate.verify2FA, async (req, res) => {
  const { secret, code, backupCodes } = req.body;

  try {
    // Verify the TOTP code
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!verified) {
      return err(res, 400, 'Invalid verification code', 'invalid_code');
    }

    // Hash backup codes
    const hashedBackupCodes = backupCodes.map((code) =>
      crypto.createHash('sha256').update(code).digest('hex')
    );

    // Store 2FA settings. SQLite uses datetime('now'); PostgreSQL uses NOW().
    const nowExpression = currentTimestamp(db.isPostgres);
    await db.query(
      `INSERT INTO user_2fa_settings (user_id, totp_secret, backup_codes, enabled, created_at)
       VALUES ($1, $2, $3, 1, ${nowExpression})
       ON CONFLICT (user_id) DO UPDATE SET
       totp_secret = $2, backup_codes = $3, enabled = 1, updated_at = ${nowExpression}`,
      [req.user.id, secret, JSON.stringify(hashedBackupCodes)]
    );
    await db.query('DELETE FROM two_factor_recovery_codes WHERE user_id = $1', [req.user.id]);
    for (const codeHash of hashedBackupCodes) {
      await db.query('INSERT INTO two_factor_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [req.user.id, codeHash]);
    }

    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (e) {
    logger.error('2fa_verify_error', { error: e.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to verify 2FA' });
  }
});

/**
 * GET /api/auth/2fa/status
 * Check if 2FA is enabled for the current user
 */
router.get('/2fa/status', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT enabled FROM user_2fa_settings WHERE user_id = $1', [
      req.user.id,
    ]);

    const enabled = rows[0]?.enabled === 1;
    res.json({ enabled });
  } catch (e) {
    logger.error('2fa_status_error', { error: e.message });
    res.status(500).json({ error: 'Failed to check 2FA status' });
  }
});

/**
 * POST /api/auth/2fa/disable
 * Disable 2FA for the current user
 */
router.post('/2fa/disable', auth, async (req, res) => {
  try {
    const nowExpression = currentTimestamp(db.isPostgres);
    await db.query(
      `UPDATE user_2fa_settings SET enabled = 0, updated_at = ${nowExpression} WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (e) {
    logger.error('2fa_disable_error', { error: e.message });
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

/**
 * Helper: Generate backup codes
 */
function generateBackupCodes(count) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

module.exports = router;
