module.exports = function requireNotBanned(req, res, next) {
  if (req.user && (req.user.banned_at || req.user.active === false)) {
    return res.status(401).json({
      error: "Invalid credentials",
    });
  }
  next();
};
