-- Migration: 004_add_nutrition_to_products
-- Description: Add nutrition JSON column to products table

ALTER TABLE products ADD COLUMN nutrition TEXT;