-- Migration: 004_add_nutrition_to_products.undo
-- Description: Remove nutrition column from products table

ALTER TABLE products DROP COLUMN nutrition;