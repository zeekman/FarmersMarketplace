const express = require("express");
const router = express.Router();
const db = require("../db/schema");
const { verifyEmail, issueVerificationToken } = require("../services/emailVerificationService");
const { sendVerificationEmail } = require("../services/emailService");

router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token is required." });
    const result = await verifyEmail(db, token);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ message: "Email verified successfully. You may now log in." });
  } catch (err) {
    console.error("verify-email error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });
    const { rows } = await db.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email.toLowerCase()]);
    const user = rows[0];
    if (!user || user.email_verified_at) {
      return res.json({ message: "If eligible, a new verification email has been sent." });
    }
    const token = await issueVerificationToken(db, user.id);
    await sendVerificationEmail(user.email, token);
    res.json({ message: "Verification email resent." });
  } catch (err) {
    console.error("resend-verification error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
