/**
 * AES-256-GCM helpers for encrypting secrets at rest.
 *
 * The encryption key is derived from process.env.ENCRYPTION_SECRET via
 * scrypt so that the raw env value never has to be exactly 32 bytes.
 *
 * Stored format (hex): salt(16) | iv(12) | authTag(16) | ciphertext
 * This is self-contained — no external key-management table needed.
 */

const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 32 };

function getSecret() {
  const s = process.env.ENCRYPTION_SECRET;
  if (!s) throw new Error('ENCRYPTION_SECRET env variable is not set');
  return s;
}

function deriveKey(secret, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(
      secret,
      salt,
      SCRYPT_PARAMS.dkLen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  );
}

async function encrypt(plaintext) {
  const secret = getSecret();
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(secret, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: salt(16) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([salt, iv, tag, ct]).toString('hex');
}

async function decrypt(encryptedHex) {
  const secret = getSecret();
  const buf = Buffer.from(encryptedHex, 'hex');
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const ct = buf.subarray(44);
  const key = await deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct) + decipher.final('utf8');
}

/**
 * Returns true if the value looks like a plaintext Stellar secret key
 * (starts with 'S' and is 56 chars — standard Stellar strkey format).
 * Used by the migration to skip already-encrypted values.
 */
function isPlaintext(value) {
  return typeof value === 'string' && /^S[A-Z2-7]{55}$/.test(value);
}

module.exports = { encrypt, decrypt, isPlaintext };
