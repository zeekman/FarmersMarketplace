-- #1648: durable, row-based outgoing webhook delivery queue.
ALTER TABLE users ADD COLUMN webhook_url TEXT;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event             TEXT NOT NULL,
  url               TEXT NOT NULL,
  secret            TEXT NOT NULL,
  payload           TEXT,
  webhook_id        TEXT NOT NULL,
  webhook_timestamp BIGINT NOT NULL,
  status_code       INTEGER,
  success           INTEGER NOT NULL DEFAULT 0,
  response_body     TEXT,
  attempt           INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'delivered', 'dead')),
  next_attempt_at   DATETIME,
  delivered_at      DATETIME,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, event)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries(status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_order
  ON webhook_deliveries(order_id);

CREATE TRIGGER IF NOT EXISTS enqueue_order_webhook_after_status
AFTER UPDATE OF status ON orders
WHEN OLD.status <> NEW.status
 AND NEW.status IN ('paid', 'shipped', 'delivered', 'cancelled', 'refunded')
BEGIN
  INSERT OR IGNORE INTO webhook_deliveries
    (order_id, event, url, secret, webhook_id, webhook_timestamp, next_attempt_at)
  SELECT NEW.id,
         CASE NEW.status
           WHEN 'paid' THEN 'order.paid'
           WHEN 'shipped' THEN 'order.shipped'
           WHEN 'delivered' THEN 'order.delivered'
           WHEN 'cancelled' THEN 'order.cancelled'
           WHEN 'refunded' THEN 'order.refunded'
         END,
         u.webhook_url, u.webhook_secret, lower(hex(randomblob(16))),
         CAST(strftime('%s','now') AS INTEGER) * 1000, CURRENT_TIMESTAMP
    FROM products p JOIN users u ON u.id = p.farmer_id
   WHERE p.id = NEW.product_id
     AND u.webhook_url IS NOT NULL AND u.webhook_secret IS NOT NULL;
END;
