-- Migration: 009_contract_upgrades
-- Audit trail for Soroban contract WASM upgrades (immutable rows)

CREATE TABLE IF NOT EXISTS contract_upgrades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id     TEXT NOT NULL,
  old_wasm_hash   TEXT NOT NULL,
  new_wasm_hash   TEXT NOT NULL,
  upgraded_by     INTEGER NOT NULL REFERENCES users(id),
  upgraded_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts_registry(contract_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contract_upgrades_contract_id ON contract_upgrades(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_upgrades_upgraded_at ON contract_upgrades(upgraded_at DESC);
