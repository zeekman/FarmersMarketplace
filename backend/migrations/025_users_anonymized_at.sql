-- Migration: 025_users_anonymized_at
-- Description: Add anonymized_at to users for GDPR anonymization tracking

ALTER TABLE users ADD COLUMN anonymized_at DATETIME;
