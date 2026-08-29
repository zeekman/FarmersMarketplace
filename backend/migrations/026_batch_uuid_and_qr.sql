-- Migration: 026_batch_uuid_and_qr
-- Description: Add UUID v4 identifier and qr_code_url to harvest_batches for public traceability

ALTER TABLE harvest_batches ADD COLUMN uuid TEXT;
ALTER TABLE harvest_batches ADD COLUMN qr_code_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_harvest_batches_uuid ON harvest_batches(uuid);
