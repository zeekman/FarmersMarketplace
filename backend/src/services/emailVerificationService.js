const crypto = require("crypto");

const TOKEN_TTL_HOURS = 24;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function issueVerificationToken(db, userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await db("users").where({ id: userId }).update({
    email_verification_token: token,
    email_verification_expires_at: expiresAt,
  });
  return token;
}

async function verifyEmail(db, token) {
  const user = await db("users")
    .where({ email_verification_token: token })
    .where("email_verification_expires_at", ">", new Date())
    .whereNull("email_verified_at")
    .first();

  if (!user) return { ok: false, error: "Token is invalid or expired." };

  await db("users").where({ id: user.id }).update({
    email_verified_at: new Date(),
    email_verification_token: null,
    email_verification_expires_at: null,
  });

  return { ok: true, userId: user.id };
}

module.exports = { issueVerificationToken, verifyEmail };
