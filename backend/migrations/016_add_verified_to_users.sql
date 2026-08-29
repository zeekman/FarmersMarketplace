-- Description: Add verified boolean to users table for verified farmer badge
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
