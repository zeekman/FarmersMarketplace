-- Migration: 030_escrow_monitor_cursor
-- Issue #862: persist last processed ledger so the event indexer resumes
-- from where it left off after a restart instead of re-processing events.

CREATE TABLE IF NOT EXISTS escrow_monitor_cursor (
  contract_id  TEXT    NOT NULL PRIMARY KEY,
  last_ledger  INTEGER NOT NULL DEFAULT 0,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
