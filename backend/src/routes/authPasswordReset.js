const express = require("express");
const router = express.Router();
const { createResetToken, consumeResetToken } = require("../services/passwordResetService");
const { sendPasswordResetEmail } = require("../services/emailService");
const logger = require("../logger");

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const result = await createResetToken(email);
    if (result) {
      await sendPasswordResetEmail(result.user.email, result.token);
    }
    res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    logger.error("forgot-password error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Token and password are required." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const result = await consumeResetToken(token, password);
    if (!result.ok) return res.status(400).json({ error: result.error });

    res.json({ message: "Password updated successfully." });
  } catch (err) {
    logger.error("reset-password error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
