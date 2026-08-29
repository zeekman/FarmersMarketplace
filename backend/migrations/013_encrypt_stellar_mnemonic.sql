-- Migration: 013_encrypt_stellar_mnemonic
-- Description: Track whether users.stellar_mnemonic holds ciphertext (AES-256-GCM,
-- see backend/src/utils/crypto.js) rather than a plaintext BIP39 phrase.
--
-- AES-256-GCM encryption itself cannot be expressed in plain SQL (it requires the
-- app-level DB_ENCRYPTION_KEY). After applying this migration, run:
--   node backend/scripts/encrypt-stellar-mnemonics.js
-- to encrypt any existing plaintext values in place and flip this flag.

ALTER TABLE users ADD COLUMN stellar_mnemonic_encrypted INTEGER NOT NULL DEFAULT 0;
