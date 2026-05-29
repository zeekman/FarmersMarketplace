-- Migration: 008_contracts_registry
-- Registered Soroban contracts (admin registry); required before contract_upgrades FK.

CREATE TABLE IF NOT EXISTS contracts_registry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('escrow', 'token', 'other')),
  network       TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deployed_by   INTEGER REFERENCES users (id),
  deployed_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contracts_registry_network ON contracts_registry (network);
CREATE INDEX IF NOT EXISTS idx_contracts_registry_type ON contracts_registry (type);
