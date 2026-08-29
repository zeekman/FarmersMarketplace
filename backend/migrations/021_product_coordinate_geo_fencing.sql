-- Migration: 021_product_coordinate_geo_fencing
-- Add coordinate-based geo-fencing columns to products table
ALTER TABLE products ADD COLUMN geo_fencing_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN geo_fence_lat REAL DEFAULT NULL;
ALTER TABLE products ADD COLUMN geo_fence_lng REAL DEFAULT NULL;
ALTER TABLE products ADD COLUMN geo_fence_radius_km REAL DEFAULT NULL;
