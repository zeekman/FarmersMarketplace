-- Undo migration: 021_add_bundle_id_to_orders
-- Description: Remove bundle_id column from orders table

ALTER TABLE orders DROP COLUMN IF EXISTS bundle_id;
