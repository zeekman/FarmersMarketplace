ALTER TABLE users DROP COLUMN IF EXISTS monthly_budget;
DROP INDEX IF EXISTS idx_orders_buyer_status_created;
