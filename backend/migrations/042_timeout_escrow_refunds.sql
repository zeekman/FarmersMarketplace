-- Backlog #1643: persist the on-chain escrow deadline and timeout-claim settlement.
-- Retry metadata prevents one repeatedly failing row from monopolizing each hourly pass.
ALTER TABLE orders ADD COLUMN timeout_unix BIGINT;
ALTER TABLE orders ADD COLUMN settlement_tx_hash TEXT;
ALTER TABLE orders ADD COLUMN timeout_refund_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN timeout_refund_retry_at BIGINT;
CREATE INDEX IF NOT EXISTS idx_orders_timeout_refunds
  ON orders (escrow_status, timeout_unix, timeout_refund_retry_at);
