-- Migration: 020_contract_invocations_index
-- Adds invocation_index column for deduplication in contractMonitor.js
-- Allows ON CONFLICT (tx_hash, invocation_index) DO NOTHING for idempotency

ALTER TABLE contract_invocations
  ADD COLUMN invocation_index INTEGER DEFAULT 0;

-- Create unique constraint for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_invocations_unique
  ON contract_invocations(tx_hash, invocation_index)
  WHERE tx_hash IS NOT NULL;
