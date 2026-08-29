-- Rollback: 024_product_expiry_notified_at
ALTER TABLE products DROP COLUMN IF EXISTS expiry_notified_at;
