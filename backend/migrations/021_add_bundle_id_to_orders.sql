-- Migration: 021_add_bundle_id_to_orders
-- Description: Add bundle_id column to orders table to track bundle purchases

ALTER TABLE orders ADD COLUMN bundle_id INTEGER REFERENCES bundles(id) ON DELETE SET NULL;
