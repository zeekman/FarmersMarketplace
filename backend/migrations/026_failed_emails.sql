-- Migration: 026_failed_emails
-- Description: Add failed_emails table for tracking emails that exhausted retry attempts

CREATE TABLE IF NOT EXISTS failed_emails (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient      TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  error_message  TEXT NOT NULL,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  first_attempt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient pruning queries
CREATE INDEX IF NOT EXISTS idx_failed_emails_created_at ON failed_emails(created_at);
CREATE TABLE IF NOT EXISTS failed_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  error TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
