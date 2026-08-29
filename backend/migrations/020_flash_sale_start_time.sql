-- Migration: 020_flash_sale_start_time
-- Description: Add flash_sale_starts_at column to products for flash sale time window validation

ALTER TABLE products ADD COLUMN IF NOT EXISTS flash_sale_starts_at TIMESTAMP;
