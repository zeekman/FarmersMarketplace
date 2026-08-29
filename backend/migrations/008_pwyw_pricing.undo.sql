-- Undo migration: 008_pwyw_pricing
-- Description: Remove pay-what-you-want and donation pricing columns

ALTER TABLE orders DROP COLUMN IF EXISTS custom_price;
ALTER TABLE products DROP COLUMN IF EXISTS min_price;
ALTER TABLE products DROP COLUMN IF EXISTS pricing_model;
