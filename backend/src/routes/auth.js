const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const {
  createWalletFromMnemonic,
  deriveKeypairFromMnemonic,
  getBalance,
} = require('../utils/stellar');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const logger = require('../logger');

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
  path: '/api/auth',
};

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: ACCESS_TOKEN_TTL });
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
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id, used) VALUES ($1, $2, $3, $4, 0)',
    [userId, hash, expiresAt, family]
  );
  return family;
}

// Returns { newToken, familyId } on success, { reuse: true, userId, familyId } on replay, null on expired/not-found.
async function rotateRefreshToken(userId, oldRawToken) {
  const oldHash = hashToken(oldRawToken);
  const { rows } = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2',
    [oldHash, userId]
  );
  const existing = rows[0];
  if (!existing) return null;

  // Replay detected: token exists but was already used — nuke the entire family
  if (existing.used) {
    await db.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND family_id = $2',
      [userId, existing.family_id]
    );
    return { reuse: true, userId, familyId: existing.family_id };
  }

  if (new Date(existing.expires_at) < new Date()) {
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [existing.id]);
    return null;
  }

  // Mark old token as used (soft-delete keeps it for reuse detection)
  await db.query('UPDATE refresh_tokens SET used = 1 WHERE id = $1', [existing.id]);
  const newRawToken = generateRefreshToken();
  await storeRefreshToken(userId, newRawToken, existing.family_id);
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
router.post('/register', validate.register, async (req, res) => {
  const { name, email, password, role, ref } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 12);
    const wallet = createWalletFromMnemonic();
    const encryptedMnemonic = await encryptMnemonic(wallet.mnemonic, password);
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
        wallet.secretKey,
        encryptedMnemonic,
        referralCode,
        referredBy,
      ]
    );
    const userId = rows[0].id;
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
router.post('/login', validate.login, async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query(
    'SELECT id, name, email, password, role, stellar_public_key FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

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
    res.clearCookie('refreshToken', { path: '/api/auth' });
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
    res.clearCookie('refreshToken', { path: '/api/auth' });
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
router.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (rawToken) {
    const hash = hashToken(rawToken);
    await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
  }
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ ok: true });
});

// DELETE /api/auth/account — self-service account deletion
router.delete('/account', auth, async (req, res) => {
  const force = req.query.force === 'true';

  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [
    req.user.id,
  ]);
  if (!rows[0]) return err(res, 404, 'User not found', 'not_found');

  // Check Stellar balance — warn if above base reserve (1 XLM)
  if (!force) {
    const balance = await getBalance(rows[0].stellar_public_key);
    if (balance > 1) {
      return res.status(409).json({
        success: false,
        code: 'balance_warning',
        message:
          'Your Stellar wallet still has a balance. Withdraw your funds before deleting your account, or confirm deletion with ?force=true.',
        balance,
        publicKey: rows[0].stellar_public_key,
      });
    }
  }

  // Delete user — cascade handles related rows (orders, refresh_tokens, etc.)
  await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);

  // Clear the refresh token cookie
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ success: true, message: 'Account deleted' });
});

/**
 * POST /api/auth/seed-phrase  (password confirmation required)
 * Returns the decrypted mnemonic ONCE per request. Never cached.
 */
router.post('/seed-phrase', auth, validate.confirmPassword, async (req, res) => {
  const { password } = req.body;
  const { rows } = await db.query('SELECT password, stellar_mnemonic FROM users WHERE id = $1', [
    req.user.id,
  ]);
  const user = rows[0];
  if (!user) return err(res, 404, 'User not found', 'not_found');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return err(res, 401, 'Incorrect password', 'invalid_credentials');

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

module.exports = router;
