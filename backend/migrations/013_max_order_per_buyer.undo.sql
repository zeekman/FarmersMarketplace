-- Migration: 013_max_order_per_buyer (Undo)
-- Description: Remove max_order_per_buyer column from products table

ALTER TABLE products DROP COLUMN max_order_per_buyer;
