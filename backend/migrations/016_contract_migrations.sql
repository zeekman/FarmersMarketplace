-- Storage migration audit trail for Soroban contract upgrades

CREATE TABLE IF NOT EXISTS contract_migrations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id     TEXT    NOT NULL,
  script          TEXT    NOT NULL,
  entries_before  TEXT    NOT NULL,
  entries_after   TEXT    NOT NULL,
  migrated_by     INTEGER NOT NULL REFERENCES users(id),
  migrated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts_registry(contract_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contract_migrations_contract_id ON contract_migrations(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_migrations_migrated_at ON contract_migrations(migrated_at DESC);
