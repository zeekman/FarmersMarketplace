const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db/schema");

const TOKEN_TTL_MINUTES = 30;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createResetToken(email) {
  const { rows } = await db.query(
    `SELECT id, email FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) return null;

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await db.query(
    `UPDATE password_reset_tokens SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL`,
    [new Date(), user.id]
  );
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  return { token, user };
}

async function consumeResetToken(token, newPassword) {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date();

  // Claim the token in the same conditional update that validates it. This
  // prevents concurrent requests from reusing a single reset token and works
  // with both the PostgreSQL and SQLite database adapters.
  const claimed = await db.query(
    `UPDATE password_reset_tokens
     SET used_at = $1
     WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1
     RETURNING id, user_id`,
    [now, tokenHash]
  );
  const record = claimed.rows[0];
  if (!record) return { ok: false, error: "Token is invalid or expired." };

  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, record.user_id]);
  return { ok: true };
}

module.exports = { createResetToken, consumeResetToken };
