const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { createWallet } = require('../utils/stellar');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

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

async function storeRefreshToken(userId, rawToken) {
  const hash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL).toISOString();
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt]
  );
}

async function rotateRefreshToken(userId, oldRawToken) {
  const oldHash = hashToken(oldRawToken);
  const { rows } = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2',
    [oldHash, userId]
  );
  const existing = rows[0];
  if (!existing) return null;
  if (new Date(existing.expires_at) < new Date()) {
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [existing.id]);
    return null;
  }
  await db.query('DELETE FROM refresh_tokens WHERE id = $1', [existing.id]);
  const newRawToken = generateRefreshToken();
  await storeRefreshToken(userId, newRawToken);
  return newRawToken;
}

// POST /api/auth/register
router.post('/register', validate.register, async (req, res) => {
  const { name, email, password, role, ref } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 12);
    const wallet = createWallet();
    const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    let referredBy = null;
    if (ref) {
      const { rows } = await db.query('SELECT id FROM users WHERE referral_code = $1', [ref]);
      if (rows[0]) referredBy = rows[0].id;
    }

    const { rows } = await db.query(
      'INSERT INTO users (name, email, password, role, stellar_public_key, stellar_secret_key, referral_code, referred_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [name, email, hashed, role, wallet.publicKey, wallet.secretKey, referralCode, referredBy]
    );
    const userId = rows[0].id;
    const accessToken = signAccessToken({ id: userId, role });
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(userId, rawRefresh);

    res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
    res.json({ token: accessToken, user: { id: userId, name, email, role, publicKey: wallet.publicKey, referralCode } });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

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
  res.json({ token: accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, publicKey: user.stellar_public_key } });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return res.status(401).json({ error: 'No refresh token' });

  const tokenHash = hashToken(rawToken);
  const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  const stored = rows[0];
  if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });
  if (new Date(stored.expires_at) < new Date()) {
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [stored.id]);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const newRawToken = await rotateRefreshToken(stored.user_id, rawToken);
  if (!newRawToken) return res.status(401).json({ error: 'Invalid refresh token' });

  const { rows: userRows } = await db.query('SELECT id, role FROM users WHERE id = $1', [stored.user_id]);
  const user = userRows[0];
  if (!user) return res.status(401).json({ error: 'User not found' });

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  res.cookie('refreshToken', newRawToken, COOKIE_OPTIONS);
  res.json({ token: accessToken });
});

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

module.exports = router;
