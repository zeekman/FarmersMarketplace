-- Rollback: 020_orders_status_refunded
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK(status IN ('pending','paid','processing','shipped','delivered','failed'));
