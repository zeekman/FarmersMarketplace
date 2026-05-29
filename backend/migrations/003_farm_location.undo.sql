-- Undo Migration: 003_farm_location
ALTER TABLE users DROP COLUMN IF EXISTS latitude;
ALTER TABLE users DROP COLUMN IF EXISTS longitude;
ALTER TABLE users DROP COLUMN IF EXISTS farm_address;
