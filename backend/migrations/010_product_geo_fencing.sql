-- Migration: 010_product_geo_fencing
-- Add allowed_regions column to products (JSON array of ISO 3166-1 alpha-2 country codes)
-- Empty / NULL means no restriction
ALTER TABLE products ADD COLUMN allowed_regions TEXT DEFAULT NULL;
