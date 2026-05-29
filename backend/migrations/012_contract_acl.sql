-- Migration: 012_contract_acl
CREATE TABLE IF NOT EXISTS contract_acl (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  address     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'admin',
  granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contract_id, address)
);
