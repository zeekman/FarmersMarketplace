-- Migration: 014_contract_invocations_args_limit
-- Description: Introduce contract_invocations, an audit log of Soroban contract calls
-- made by the backend (escrow deposit/release/refund/dispute, carbon offset, reward
-- mints, etc). `args` stores the serialized call arguments and is capped at 4000
-- characters — backend/src/jobs/contractMonitor.js must truncate to this limit
-- (and log a warning) before INSERT, since a raw CHECK violation would otherwise
-- reject the whole audit row.

CREATE TABLE IF NOT EXISTS contract_invocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  action      TEXT NOT NULL,
  args        TEXT CHECK (length(args) <= 4000),
  tx_hash     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_invocations_contract_id ON contract_invocations(contract_id);
