-- Migration: 026_failed_emails (undo)
-- Description: Remove failed_emails table

DROP INDEX IF EXISTS idx_failed_emails_created_at;
DROP TABLE IF EXISTS failed_emails;
DROP TABLE IF EXISTS failed_emails;
