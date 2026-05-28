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
  const user = await db("users").where({ email: email.toLowerCase() }).first();
  if (!user) return null;

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await db("password_reset_tokens")
    .where({ user_id: user.id, used_at: null })
    .update({ used_at: new Date() });

  await db("password_reset_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return { token, user };
}

async function consumeResetToken(db, token, newPassword) {
  const tokenHash = hashToken(token);
  const record = await db("password_reset_tokens")
    .where({ token_hash: tokenHash, used_at: null })
    .where("expires_at", ">", new Date())
    .first();

  if (!record) return { ok: false, error: "Token is invalid or expired." };

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await db.transaction(async (trx) => {
    await trx("users").where({ id: record.user_id }).update({ password_hash: passwordHash });
    await trx("password_reset_tokens").where({ id: record.id }).update({ used_at: new Date() });
  });

  return { ok: true };
}

module.exports = { createResetToken, consumeResetToken };
