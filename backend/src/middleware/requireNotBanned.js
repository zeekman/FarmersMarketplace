module.exports = function requireNotBanned(req, res, next) {
  if (req.user && req.user.banned_at) {
    return res.status(403).json({
      error: "Your account has been suspended. Please contact support.",
    });
  }
  next();
};
