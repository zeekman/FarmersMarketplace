-- Backlog 014: record the escrow settlement transaction separately from the
-- buyer's original payment transaction.
--
-- Previously POST /:id/refund, POST /:id/claim and POST /:id/claim-preorder ran
-- `UPDATE orders SET escrow_status = $1, stellar_tx_hash = $2`, overwriting the
-- buyer's payment hash with the refund/claim hash. Receipts, exports, disputes
-- and the buyer's wallet history then pointed at the wrong transaction.
--
-- From now on stellar_tx_hash keeps the payment transaction and the settlement
-- transaction is written to settlement_tx_hash/settlement_type/settled_at.
--
-- Backfill: historical settlements cannot be recovered — the original payment
-- hash was already overwritten and is gone, and the settlement hash was never
-- stored anywhere else. Existing rows are therefore left as-is: stellar_tx_hash
-- is kept unchanged and the new settlement_* columns stay NULL. They are only
-- populated for settlements that happen after this migration.

ALTER TABLE orders ADD COLUMN settlement_tx_hash TEXT;
ALTER TABLE orders ADD COLUMN settlement_type TEXT CHECK (settlement_type IN ('release', 'claim', 'refund', 'resolve'));
ALTER TABLE orders ADD COLUMN settled_at DATETIME;
