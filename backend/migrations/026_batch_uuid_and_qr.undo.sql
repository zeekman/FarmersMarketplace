-- Undo Migration: 026_batch_uuid_and_qr
DROP INDEX IF EXISTS idx_harvest_batches_uuid;
ALTER TABLE harvest_batches DROP COLUMN IF EXISTS uuid;
ALTER TABLE harvest_batches DROP COLUMN IF EXISTS qr_code_url;
