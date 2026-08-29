-- Rollback: 019_contract_invocations_args_limit
-- SQLite does not support DROP CONSTRAINT; this is a no-op for SQLite.
-- PostgreSQL:
ALTER TABLE contract_invocations
  DROP CONSTRAINT IF EXISTS chk_contract_invocations_args_length;
