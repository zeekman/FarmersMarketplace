-- Migration 027: Add webhook_secret column to users table for farmer webhook HMAC verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
