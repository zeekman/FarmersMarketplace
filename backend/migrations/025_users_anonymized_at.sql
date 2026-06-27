-- Migration 025: add anonymized_at to users for GDPR right-to-erasure tracking
ALTER TABLE users ADD COLUMN anonymized_at DATETIME;
