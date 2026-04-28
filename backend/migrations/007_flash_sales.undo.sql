ALTER TABLE products
DROP COLUMN IF EXISTS flash_sale_price,
DROP COLUMN IF EXISTS flash_sale_ends_at;
