CREATE TABLE IF NOT EXISTS contract_invocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT    NOT NULL,
  method      TEXT    NOT NULL,
  args        TEXT,
  result      TEXT,
  tx_hash     TEXT,
  success     INTEGER NOT NULL DEFAULT 1,
  error       TEXT,
  invoked_by  INTEGER REFERENCES users(id),
  invoked_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_invocations_contract_id ON contract_invocations(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_invocations_invoked_at  ON contract_invocations(invoked_at);
