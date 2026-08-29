-- Undo Migration: 014_contract_invocations_args_limit
-- contract_invocations is introduced by this migration (not altering a pre-existing
-- table), so dropping it here cannot discard data that existed before this migration.

DROP INDEX IF EXISTS idx_contract_invocations_contract_id;
DROP TABLE IF EXISTS contract_invocations;
