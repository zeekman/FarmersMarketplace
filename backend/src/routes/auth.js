const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { createWallet } = require('../utils/stellar');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: REFRESH_TOKEN_TTL,
  path: '/api/auth', // scope cookie to auth routes only
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

function storeRefreshToken(userId, rawToken) {
  const hash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL).toISOString();
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(userId, hash, expiresAt);
}

function rotateRefreshToken(userId, oldRawToken) {
  const oldHash = hashToken(oldRawToken);
  const existing = db.prepare(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND user_id = ?'
  ).get(oldHash, userId);

  if (!existing) return null;
  if (new Date(existing.expires_at) < new Date()) {
    // expired — clean it up
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(existing.id);
    return null;
  }

  // Rotate: delete old, issue new
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(existing.id);
  const newRawToken = generateRefreshToken();
  storeRefreshToken(userId, newRawToken);
  return newRawToken;
}

// POST /api/auth/register
router.post('/register', validate.register, async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 12);
    const wallet = createWallet();

    const result = db.prepare(
      'INSERT INTO users (name, email, password, role, stellar_public_key, stellar_secret_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, email, hashed, role, wallet.publicKey, wallet.secretKey);

    const userId = result.lastInsertRowid;
    const accessToken = signAccessToken({ id: userId, role });
    const rawRefresh = generateRefreshToken();
    storeRefreshToken(userId, rawRefresh);

    res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
    res.json({
      token: accessToken,
      user: { id: userId, name, email, role, publicKey: wallet.publicKey },
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
    const token = jwt.sign(
      { id: result.lastInsertRowid, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, user: { id: result.lastInsertRowid, name, email, role, publicKey: wallet.publicKey } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return err(res, 409, 'Email already exists', 'email_taken');
    throw e;
  }
});

// POST /api/auth/login
router.post('/login', validate.login, async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return err(res, 401, 'Invalid credentials', 'invalid_credentials');

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const rawRefresh = generateRefreshToken();
  storeRefreshToken(user.id, rawRefresh);

  res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
  res.json({
    token: accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, publicKey: user.stellar_public_key },
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return res.status(401).json({ error: 'No refresh token' });

  // We need the user_id — decode it from the hash lookup
  const tokenHash = hashToken(rawToken);
  const stored = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });
  if (new Date(stored.expires_at) < new Date()) {
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const newRawToken = rotateRefreshToken(stored.user_id, rawToken);
  if (!newRawToken) return res.status(401).json({ error: 'Invalid refresh token' });

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(stored.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  res.cookie('refreshToken', newRawToken, COOKIE_OPTIONS);
  res.json({ token: accessToken });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (rawToken) {
    const hash = hashToken(rawToken);
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hash);
  }
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ ok: true });
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role, publicKey: user.stellar_public_key } });
});

module.exports = router;
