-- Migration: 016_push_notification_history
CREATE TABLE IF NOT EXISTS push_notification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT,
  title TEXT,
  body TEXT,
  payload TEXT,
  status TEXT NOT NULL CHECK(status IN ('sent','delivered','failed')),
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
