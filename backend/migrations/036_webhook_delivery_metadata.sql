-- Webhook delivery storage (completed by #1648 in migration 042).
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  payload TEXT,
  webhook_id TEXT NOT NULL,
  webhook_timestamp BIGINT NOT NULL,
  status_code INTEGER,
  success INTEGER NOT NULL DEFAULT 0,
  response_body TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'delivered', 'dead')),
  next_attempt_at DATETIME,
  delivered_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, event)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id_attempt ON webhook_deliveries(webhook_id, attempt);
