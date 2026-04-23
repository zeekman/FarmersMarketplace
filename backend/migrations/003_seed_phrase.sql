-- Migration: 003_seed_phrase
-- Description: Add encrypted BIP39 mnemonic column to users table

ALTER TABLE users ADD COLUMN stellar_mnemonic TEXT;
