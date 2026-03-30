-- Rollback: 008_contracts_registry
DROP INDEX IF EXISTS idx_contracts_registry_type;
DROP INDEX IF EXISTS idx_contracts_registry_network;
DROP TABLE IF EXISTS contracts_registry;
