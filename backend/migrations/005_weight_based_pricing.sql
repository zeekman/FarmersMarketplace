-- Migration: 005_weight_based_pricing
-- Description: Add weight-based pricing fields to products and weight to orders

ALTER TABLE products ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'unit' CHECK(pricing_type IN ('unit', 'weight'));
ALTER TABLE products ADD COLUMN min_weight REAL;
ALTER TABLE products ADD COLUMN max_weight REAL;

ALTER TABLE orders ADD COLUMN weight REAL;
