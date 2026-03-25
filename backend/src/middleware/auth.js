const jwt = require('jsonwebtoken');
const { err } = require('./error');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return err(res, 401, 'No token provided', 'missing_token');

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    err(res, 401, 'Invalid token', 'invalid_token');
  }
};
