-- Rollback: 003_waitlist_entries
-- Description: Remove waitlist_entries table and associated indexes

DROP INDEX IF EXISTS idx_waitlist_buyer;
DROP INDEX IF EXISTS idx_waitlist_product_position;
DROP TABLE IF EXISTS waitlist_entries;