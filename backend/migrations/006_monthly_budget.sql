ALTER TABLE users
ADD COLUMN IF NOT EXISTS monthly_budget REAL;

CREATE INDEX IF NOT EXISTS idx_orders_buyer_status_created
ON orders(buyer_id, status, created_at);
