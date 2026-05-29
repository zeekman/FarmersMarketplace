const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
const { err } = require('./error');

module.exports = (req, res, next) => {
  if (!req.user) return err(res, 401, 'Authentication required', 'missing_token');
  if (req.user.role !== 'admin') return err(res, 403, 'Admin access required', 'forbidden');
  next();
};
