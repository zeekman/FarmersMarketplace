-- Backlog 014: record the escrow settlement transaction separately from the
-- buyer's original payment transaction (PostgreSQL).
--
-- See 042_order_settlement_tx.sql for the full rationale.
--
-- Backfill: historical settlements cannot be recovered — the original payment
-- hash was already overwritten and is gone, and the settlement hash was never
-- stored anywhere else. Existing rows are therefore left as-is: stellar_tx_hash
-- is kept unchanged and the new settlement_* columns stay NULL. They are only
-- populated for settlements that happen after this migration.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_tx_hash TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_type TEXT CHECK (settlement_type IN ('release', 'claim', 'refund', 'resolve'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
