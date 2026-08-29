-- Rollback: remove retry_count, retry_after, and revert status CHECK
CREATE TABLE IF NOT EXISTS subscriptions_old (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id      INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  quantity      INTEGER NOT NULL,
  frequency     TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly')),
  next_order_at DATETIME NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled')),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id)   REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

INSERT INTO subscriptions_old (id, buyer_id, product_id, quantity, frequency, next_order_at, active, status, created_at)
SELECT id, buyer_id, product_id, quantity, frequency, next_order_at, active,
  CASE WHEN status = 'failed' THEN 'cancelled' ELSE status END,
  created_at
FROM subscriptions;

DROP TABLE subscriptions;
ALTER TABLE subscriptions_old RENAME TO subscriptions;
