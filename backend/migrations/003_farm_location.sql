-- Migration: 003_farm_location
-- Description: Add farm location fields to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude REAL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude REAL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS farm_address TEXT;
