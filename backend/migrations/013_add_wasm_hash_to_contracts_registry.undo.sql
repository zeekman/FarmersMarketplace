-- Rollback: 013_add_wasm_hash_to_contracts_registry
-- Remove wasm_hash column from contracts_registry

ALTER TABLE contracts_registry DROP COLUMN IF EXISTS wasm_hash;