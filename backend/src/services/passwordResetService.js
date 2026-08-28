const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const TOKEN_TTL_MINUTES = 30;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createResetToken(db, email) {
  const { rows: users } = await db.query(
    'SELECT id, email FROM users WHERE email = $1 LIMIT 1',
    [email.toLowerCase()]
  );
  const user = users[0];
  if (!user) return null;

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await db.query(
    'UPDATE password_reset_tokens SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL',
    [new Date(), user.id]
  );

  await db.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, tokenHash, expiresAt]
  );

  return { token, user };
}

async function consumeResetToken(db, token, newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  const tokenHash = hashToken(token);
  const { rows } = await db.query(
    `SELECT id, user_id
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
     LIMIT 1`,
    [tokenHash, new Date()]
  );
  const record = rows[0];

  if (!record) return { ok: false, error: "Token is invalid or expired." };

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await db.query('UPDATE users SET password = $1 WHERE id = $2', [passwordHash, record.user_id]);
  await db.query('UPDATE password_reset_tokens SET used_at = $1 WHERE id = $2', [new Date(), record.id]);

  return { ok: true };
}

module.exports = { createResetToken, consumeResetToken };
