-- Undo backlog 014: remove the escrow settlement columns from orders

ALTER TABLE orders DROP COLUMN IF EXISTS settlement_tx_hash;
ALTER TABLE orders DROP COLUMN IF EXISTS settlement_type;
ALTER TABLE orders DROP COLUMN IF EXISTS settled_at;
