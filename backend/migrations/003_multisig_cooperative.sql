CREATE TABLE IF NOT EXISTS cooperatives (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  stellar_public_key TEXT,
  stellar_secret_key TEXT,
  multisig_threshold INTEGER NOT NULL DEFAULT 1,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cooperative_members (
  cooperative_id INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  PRIMARY KEY (cooperative_id, user_id),
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pending_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cooperative_id INTEGER NOT NULL,
  initiator_id   INTEGER NOT NULL,
  xdr            TEXT NOT NULL,
  amount         REAL NOT NULL,
  destination    TEXT NOT NULL,
  memo           TEXT,
  signatures     TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','expired','cancelled')),
  expires_at     DATETIME NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE CASCADE,
  FOREIGN KEY (initiator_id)   REFERENCES users(id)
);
