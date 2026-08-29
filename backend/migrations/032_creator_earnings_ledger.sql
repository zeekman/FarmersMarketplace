-- Migration: 032_creator_earnings_ledger
-- Issue #995: ledger of Creator Earnings contract credit/claim events, so
-- backend jobs and analytics endpoints have a persisted history to query
-- instead of hitting the Soroban RPC live on every read.

CREATE TABLE IF NOT EXISTS creator_earnings_ledger (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_address  TEXT    NOT NULL,
  amount           REAL    NOT NULL,
  fee_amount       REAL    NOT NULL DEFAULT 0,
  tx_hash          TEXT    NOT NULL,
  event_type       TEXT    NOT NULL CHECK (event_type IN ('credit', 'claim')),
  ledger_sequence  INTEGER NOT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tx_hash, event_type, ledger_sequence)
);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_ledger_creator_address ON creator_earnings_ledger (creator_address);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_ledger_created_at ON creator_earnings_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_ledger_ledger_sequence ON creator_earnings_ledger (ledger_sequence);
