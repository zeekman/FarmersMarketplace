-- Migration: 003_freshness_dates.undo
-- Description: Remove harvest_date and best_before columns from products table

ALTER TABLE products DROP COLUMN harvest_date;
ALTER TABLE products DROP COLUMN best_before;