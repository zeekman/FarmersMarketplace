-- Undo: 021_harvest_batch_traceability
ALTER TABLE harvest_batches DROP COLUMN IF EXISTS location;
ALTER TABLE harvest_batches DROP COLUMN IF EXISTS certifications;
