-- Migration: 018_contracts_registry_contract_id_index
-- Adds a unique index on contracts_registry(contract_id) to avoid full table
-- scans when looking up a contract by its Soroban contract ID.

CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_registry_contract_id
  ON contracts_registry (contract_id);
