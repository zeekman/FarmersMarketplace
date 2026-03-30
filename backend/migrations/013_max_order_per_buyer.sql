-- Migration: 013_max_order_per_buyer
-- Description: Add max_order_per_buyer column to products table

ALTER TABLE products ADD COLUMN max_order_per_buyer INTEGER DEFAULT NULL;
