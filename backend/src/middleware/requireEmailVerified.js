module.exports = function requireEmailVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized." });
  if (!req.user.email_verified_at) {
    return res.status(403).json({
      error: "Email not verified. Please check your inbox and verify your email before logging in.",
    });
  }
  next();
};
