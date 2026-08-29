-- Migration: 024_product_expiry_notified_at
-- Description: Add expiry_notified_at to products for idempotent expiry job tracking

ALTER TABLE products ADD COLUMN expiry_notified_at DATETIME;
