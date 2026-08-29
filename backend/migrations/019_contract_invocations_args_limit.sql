-- Migration: 019_contract_invocations_args_limit
-- Adds a CHECK constraint on contract_invocations.args to enforce a 65 535-byte
-- (64 KiB) maximum. SQLite ignores CHECK constraints on existing rows but will
-- enforce them on new inserts. PostgreSQL enforces immediately.
-- The application layer truncates oversized args before insert (see contracts.js).

ALTER TABLE contract_invocations
  ADD CONSTRAINT chk_contract_invocations_args_length
  CHECK (args IS NULL OR length(args) <= 65535);
