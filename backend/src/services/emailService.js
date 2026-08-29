const { sendWithRetry } = require("../utils/mailer");

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendVerificationEmail(email, token) {
  if (!smtpConfigured()) return;
  return sendWithRetry(
    {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Verify your Farmers Marketplace email",
      text: `Verify your email with this token: ${token}`,
    },
    "email_verification"
  );
}

async function sendPasswordResetEmail(email, token) {
  if (!smtpConfigured()) return;
  return sendWithRetry(
    {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Reset your Farmers Marketplace password",
      text: `Use this password reset token: ${token}`,
    },
    "password_reset"
  );
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
