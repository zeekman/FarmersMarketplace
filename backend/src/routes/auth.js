const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { createWallet } = require('../utils/stellar');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');

// POST /api/auth/register
router.post('/register', validate.register, async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    const hashed = await bcrypt.hash(password, 10);
    const wallet = createWallet();

    const stmt = db.prepare(
      'INSERT INTO users (name, email, password, role, stellar_public_key, stellar_secret_key) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(name, email, hashed, role, wallet.publicKey, wallet.secretKey);

    const token = jwt.sign(
      { id: result.lastInsertRowid, role },
      process.env.JWT_SECRET || 'secret',
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

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );

  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role, publicKey: user.stellar_public_key } });
});

module.exports = router;
