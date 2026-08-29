const crypto = require("crypto");
const db = require("../db/schema");

const TOKEN_TTL_HOURS = 24;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function issueVerificationToken(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await db.query(
    `UPDATE users
     SET email_verification_token = $1, email_verification_expires_at = $2
     WHERE id = $3`,
    [token, expiresAt, userId]
  );

  return token;
}

async function verifyEmail(token) {
  const { rows } = await db.query(
    `SELECT id FROM users
     WHERE email_verification_token = $1
       AND email_verification_expires_at > $2
       AND email_verified_at IS NULL
     LIMIT 1`,
    [token, new Date()]
  );

  const user = rows[0];
  if (!user) return { ok: false, error: "Token is invalid or expired." };

  await db.query(
    `UPDATE users
     SET email_verified_at = $1,
         email_verification_token = NULL,
         email_verification_expires_at = NULL
     WHERE id = $2`,
    [new Date(), user.id]
  );

  return { ok: true, userId: user.id };
}

module.exports = { issueVerificationToken, verifyEmail };

// Exported for focused unit tests without exposing database access to callers.
module.exports.generateToken = generateToken;
