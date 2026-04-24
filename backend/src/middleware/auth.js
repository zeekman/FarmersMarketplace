const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { err } = require('./error');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return err(res, 401, 'No token provided', 'missing_token');

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    // Check if user is still active
    const { rows } = await db.query('SELECT active FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || rows[0].active !== 1) {
      return err(res, 401, 'Account deactivated', 'deactivated');
    }
    next();
  } catch {
    err(res, 401, 'Invalid token', 'invalid_token');
  }
};
