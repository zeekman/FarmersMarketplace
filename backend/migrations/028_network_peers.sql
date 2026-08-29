CREATE TABLE IF NOT EXISTS network_peers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  url       TEXT NOT NULL UNIQUE,
  name      TEXT,
  public_key TEXT,
  verified  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
