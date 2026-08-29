-- Rollback: 032_creator_earnings_ledger
DROP INDEX IF EXISTS idx_creator_earnings_ledger_ledger_sequence;
DROP INDEX IF EXISTS idx_creator_earnings_ledger_created_at;
DROP INDEX IF EXISTS idx_creator_earnings_ledger_creator_address;
DROP TABLE IF EXISTS creator_earnings_ledger;
