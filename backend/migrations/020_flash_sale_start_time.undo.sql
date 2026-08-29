-- Migration Undo: 020_flash_sale_start_time
-- Description: Remove flash_sale_starts_at column from products

ALTER TABLE products DROP COLUMN IF EXISTS flash_sale_starts_at;
