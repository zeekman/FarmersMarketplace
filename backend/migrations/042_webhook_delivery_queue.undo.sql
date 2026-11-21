DROP TRIGGER IF EXISTS enqueue_order_webhook_after_status;
DROP INDEX IF EXISTS idx_webhook_deliveries_due;
DROP INDEX IF EXISTS idx_webhook_deliveries_order;
DROP TABLE IF EXISTS webhook_deliveries;
ALTER TABLE users DROP COLUMN webhook_url;
