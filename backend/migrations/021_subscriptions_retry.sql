-- Add retry tracking and failed status to subscriptions
ALTER TABLE subscriptions ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN retry_after DATETIME;

-- SQLite does not support modifying CHECK constraints; recreate the table
-- For PostgreSQL, we alter the constraint directly.
-- The migration runner handles both via the dual-mode db layer.
-- We use a trigger-free approach: drop and recreate with new CHECK.
-- Since SQLite ALTER TABLE cannot modify constraints, we recreate the table.

-- Create new table with updated CHECK
CREATE TABLE IF NOT EXISTS subscriptions_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id      INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  quantity      INTEGER NOT NULL,
  frequency     TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly')),
  next_order_at DATETIME NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled', 'failed')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  retry_after   DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id)   REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

INSERT INTO subscriptions_new (id, buyer_id, product_id, quantity, frequency, next_order_at, active, status, retry_count, retry_after, created_at)
SELECT id, buyer_id, product_id, quantity, frequency, next_order_at, active, status, 0, NULL, created_at
FROM subscriptions;

DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;
