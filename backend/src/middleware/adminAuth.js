const { err } = require('./error');

module.exports = (req, res, next) => {
  if (!req.user) return err(res, 401, 'Authentication required', 'missing_token');
  if (req.user.role !== 'admin') return err(res, 403, 'Admin access required', 'forbidden');
  next();
};
