-- Migration: 008_pwyw_pricing
-- Description: Add pay-what-you-want and donation pricing models

ALTER TABLE products ADD COLUMN pricing_model TEXT DEFAULT 'fixed';
ALTER TABLE products ADD COLUMN min_price REAL;
ALTER TABLE orders ADD COLUMN custom_price REAL;
