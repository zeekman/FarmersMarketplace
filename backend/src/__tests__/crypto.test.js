/**
 * crypto.test.js  (#1145)
 *
 * Unit tests for backend/src/utils/crypto.js
 * Covers: round-trip correctness, fresh IV per call (ciphertext uniqueness),
 * tampered-ciphertext rejection (GCM auth-tag mismatch), missing env var,
 * invalid inputs, decryptUserSecretKey, and isPlaintext helpers.
 */

'use strict';

describe('utils/crypto', () => {
  let originalSecret;

  beforeEach(() => {
    originalSecret = process.env.ENCRYPTION_SECRET;
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-for-jest-suite';
    jest.resetModules();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.ENCRYPTION_SECRET;
    } else {
      process.env.ENCRYPTION_SECRET = originalSecret;
    }
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function loadCrypto() {
    return require('../utils/crypto');
  }

  // ── round-trip: decrypt(encrypt(x)) === x ──────────────────────────────────

  describe('round-trip encrypt / decrypt', () => {
    it('decrypts a short plaintext back to the original', async () => {
      const { encrypt, decrypt } = loadCrypto();
      const plaintext = 'hello-secret';
      const ciphertext = await encrypt(plaintext);
      expect(await decrypt(ciphertext)).toBe(plaintext);
    });

    it('handles a long plaintext (multi-block)', async () => {
      const { encrypt, decrypt } = loadCrypto();
      const plaintext = 'A'.repeat(1024);
      const ciphertext = await encrypt(plaintext);
      expect(await decrypt(ciphertext)).toBe(plaintext);
    });

    it('handles unicode characters in plaintext', async () => {
      const { encrypt, decrypt } = loadCrypto();
      const plaintext = '🌿 Farmers Ñoño — café';
      const ciphertext = await encrypt(plaintext);
      expect(await decrypt(ciphertext)).toBe(plaintext);
    });

    it('produces a hex string from encrypt()', async () => {
      const { encrypt } = loadCrypto();
      const ciphertext = await encrypt('value');
      // Must be non-empty hex
      expect(ciphertext).toMatch(/^[0-9a-f]+$/);
    });

    it('round-trips a Stellar secret key-shaped string', async () => {
      const { encrypt, decrypt } = loadCrypto();
      // 56-char Stellar seed format (S + 55 uppercase base32 chars, valid base32 alphabet)
      const stellarSecret = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
      const ciphertext = await encrypt(stellarSecret);
      expect(await decrypt(ciphertext)).toBe(stellarSecret);
    });
  });

  // ── fresh nonce / IV per encryption call ──────────────────────────────────

  describe('ciphertext uniqueness', () => {
    it('produces different ciphertext for the same plaintext across two calls', async () => {
      const { encrypt } = loadCrypto();
      const plaintext = 'same-plaintext';
      const c1 = await encrypt(plaintext);
      const c2 = await encrypt(plaintext);
      expect(c1).not.toBe(c2);
    });

    it('produces different ciphertext across three calls', async () => {
      const { encrypt } = loadCrypto();
      const results = await Promise.all([encrypt('x'), encrypt('x'), encrypt('x')]);
      const unique = new Set(results);
      expect(unique.size).toBe(3);
    });
  });

  // ── tampered ciphertext must be rejected ──────────────────────────────────

  describe('tampered ciphertext detection', () => {
    it('throws when the ciphertext body is corrupted (auth-tag mismatch)', async () => {
      const { encrypt, decrypt } = loadCrypto();
      const ciphertext = await encrypt('secret-value');

      // Flip the last byte of the hex-encoded ciphertext
      const buf = Buffer.from(ciphertext, 'hex');
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString('hex');

      await expect(decrypt(tampered)).rejects.toThrow();
    });

    it('throws when the auth tag bytes are zeroed out', async () => {
      const { encrypt, decrypt } = loadCrypto();
      const ciphertext = await encrypt('another-secret');

      // Layout: salt(16) | iv(12) | authTag(16) | ciphertext
      const buf = Buffer.from(ciphertext, 'hex');
      // Zero the auth tag region
      buf.fill(0, 16 + 12, 16 + 12 + 16);
      const tampered = buf.toString('hex');

      await expect(decrypt(tampered)).rejects.toThrow();
    });

    it('throws when completely random bytes are passed to decrypt()', async () => {
      const { decrypt } = loadCrypto();
      const random = require('crypto').randomBytes(80).toString('hex');
      await expect(decrypt(random)).rejects.toThrow();
    });
  });

  // ── wrong encryption key ───────────────────────────────────────────────────

  describe('key mismatch', () => {
    it('throws when decrypting with a different ENCRYPTION_SECRET', async () => {
      const { encrypt } = loadCrypto();
      const ciphertext = await encrypt('key-sensitive-data');

      // Swap to a different secret
      process.env.ENCRYPTION_SECRET = 'completely-different-secret-xyz';
      jest.resetModules();
      const { decrypt } = require('../utils/crypto');

      await expect(decrypt(ciphertext)).rejects.toThrow();
    });
  });

  // ── input validation ───────────────────────────────────────────────────────

  describe('input validation', () => {
    it('encrypt() throws for an empty string', async () => {
      const { encrypt } = loadCrypto();
      await expect(encrypt('')).rejects.toThrow();
    });

    it('encrypt() throws for a non-string argument', async () => {
      const { encrypt } = loadCrypto();
      await expect(encrypt(42)).rejects.toThrow();
      await expect(encrypt(null)).rejects.toThrow();
    });

    it('decrypt() throws for a non-string argument', async () => {
      const { decrypt } = loadCrypto();
      await expect(decrypt(123)).rejects.toThrow();
    });

    it('decrypt() throws for a too-short hex string', async () => {
      const { decrypt } = loadCrypto();
      // Less than salt(16) + iv(12) + authTag(16) = 44 bytes → 88 hex chars
      const short = 'aa'.repeat(10); // 10 bytes
      await expect(decrypt(short)).rejects.toThrow();
    });
  });

  // ── missing ENCRYPTION_SECRET ──────────────────────────────────────────────

  describe('missing ENCRYPTION_SECRET', () => {
    it('encrypt() throws when ENCRYPTION_SECRET is not set', async () => {
      delete process.env.ENCRYPTION_SECRET;
      jest.resetModules();
      const { encrypt } = require('../utils/crypto');
      await expect(encrypt('value')).rejects.toThrow('ENCRYPTION_SECRET');
    });

    it('decrypt() throws when ENCRYPTION_SECRET is not set', async () => {
      // We need a valid ciphertext first, so produce it before clearing env
      const { encrypt } = loadCrypto();
      const ciphertext = await encrypt('data');

      delete process.env.ENCRYPTION_SECRET;
      jest.resetModules();
      const { decrypt } = require('../utils/crypto');
      await expect(decrypt(ciphertext)).rejects.toThrow('ENCRYPTION_SECRET');
    });
  });

  // ── isPlaintext ────────────────────────────────────────────────────────────

  describe('isPlaintext()', () => {
    it('returns true for a valid Stellar secret key', () => {
      const { isPlaintext } = loadCrypto();
      // Stellar secret keys: S + 55 uppercase base32 chars = 56 total chars
      expect(isPlaintext('SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW')).toBe(true);
    });

    it('returns false for a hex-encoded ciphertext string', () => {
      const { isPlaintext } = loadCrypto();
      expect(isPlaintext('aabb'.repeat(20))).toBe(false);
    });

    it('returns false for an empty string', () => {
      const { isPlaintext } = loadCrypto();
      expect(isPlaintext('')).toBe(false);
    });

    it('returns false for a non-string', () => {
      const { isPlaintext } = loadCrypto();
      expect(isPlaintext(null)).toBe(false);
      expect(isPlaintext(42)).toBe(false);
    });
  });

  // ── decryptUserSecretKey ───────────────────────────────────────────────────

  describe('decryptUserSecretKey()', () => {
    // Valid 56-char Stellar secret key (S + 55 base32 uppercase chars)
    const STELLAR_KEY = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

    it('returns a Stellar plaintext key unchanged (no decryption attempted)', async () => {
      const { decryptUserSecretKey } = loadCrypto();
      const result = await decryptUserSecretKey(STELLAR_KEY);
      expect(result).toBe(STELLAR_KEY);
    });

    it('decrypts an encrypted secret key back to the original plaintext', async () => {
      const { encrypt, decryptUserSecretKey } = loadCrypto();
      const ciphertext = await encrypt(STELLAR_KEY);
      const result = await decryptUserSecretKey(ciphertext);
      expect(result).toBe(STELLAR_KEY);
    });
  });
});
