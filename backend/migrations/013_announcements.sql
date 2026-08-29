-- Migration: 013_announcements
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'error')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);
