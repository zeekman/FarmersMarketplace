/**
 * AES-256-GCM helpers for encrypting secrets at rest.
 *
 * The encryption key is derived from process.env.ENCRYPTION_SECRET via scrypt
 * so the raw environment value does not need to be exactly 32 bytes.
 *
 * Stored format (hex): salt(16) | iv(12) | authTag(16) | ciphertext.
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 32 };
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getSecret() {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error('ENCRYPTION_SECRET env variable is not set');
  return secret;
}

function deriveKey(secret, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(
      secret,
      salt,
      SCRYPT_PARAMS.dkLen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  );
}

async function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.length) {
    throw new Error('encrypt() requires a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = await deriveKey(getSecret(), salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, ciphertext]).toString('hex');
}

async function decrypt(encryptedHex) {
  if (typeof encryptedHex !== 'string') {
    throw new Error('decrypt() requires an encrypted string');
  }
  const buffer = Buffer.from(encryptedHex, 'hex');
  if (buffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('decrypt() requires a valid encrypted payload');
  }
  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = buffer.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = buffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const key = await deriveKey(getSecret(), salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Failed to decrypt value: ENCRYPTION_SECRET does not match the key used to encrypt it'
    );
  }
}

function isPlaintext(value) {
  return typeof value === 'string' && /^S[A-Z2-7]{55}$/.test(value);
}

async function decryptUserSecretKey(value) {
  if (isPlaintext(value)) return value;
  return decrypt(value);
}

module.exports = { encrypt, decrypt, decryptUserSecretKey, isPlaintext };
