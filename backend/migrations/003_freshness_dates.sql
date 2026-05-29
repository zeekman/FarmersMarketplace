-- Migration: 003_freshness_dates
-- Description: Add harvest_date and best_before columns to products table for freshness tracking

ALTER TABLE products ADD COLUMN harvest_date DATE;
ALTER TABLE products ADD COLUMN best_before DATE;