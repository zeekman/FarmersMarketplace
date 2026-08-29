const express = require("express");
const router = express.Router();
const { ipKeyGenerator } = require("express-rate-limit");
const rateLimit = require("express-rate-limit");
const { verifyEmail, issueVerificationToken } = require("../services/emailVerificationService");
const { sendVerificationEmail } = require("../services/emailService");
const db = require("../db/schema");
const logger = require("../logger");

const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    const email = req.body?.email;
    return email ? email.toLowerCase() : ipKeyGenerator(req.ip);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resend attempts. Please try again later.', code: 'rate_limited' },
});

router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token is required." });
    const result = await verifyEmail(token);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ message: "Email verified successfully. You may now log in." });
  } catch (err) {
    logger.error("verify-email error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error." });
  }
});

router.post("/resend-verification", resendVerificationLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const { rows } = await db.query(
      `SELECT id, email, email_verified_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email.toLowerCase()]
    );
    const user = rows[0];

    if (!user || user.email_verified_at) {
      return res.json({ message: "If eligible, a new verification email has been sent." });
    }

    const token = await issueVerificationToken(user.id);
    await sendVerificationEmail(user.email, token);
    res.json({ message: "Verification email resent." });
  } catch (err) {
    logger.error("resend-verification error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
