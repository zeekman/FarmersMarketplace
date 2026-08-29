-- Migration: 013_contract_alerts
CREATE TABLE IF NOT EXISTS contract_alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id  TEXT NOT NULL,
  alert_type   TEXT NOT NULL CHECK (alert_type IN ('failed_invocations', 'large_transfer')),
  message      TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_alerts_contract_id ON contract_alerts(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_alerts_created_at  ON contract_alerts(created_at DESC);
