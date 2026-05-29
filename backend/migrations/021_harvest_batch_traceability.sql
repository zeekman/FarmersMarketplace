-- Migration: 021_harvest_batch_traceability
-- Adds location and certifications fields to harvest_batches for traceability

ALTER TABLE harvest_batches ADD COLUMN location TEXT;
ALTER TABLE harvest_batches ADD COLUMN certifications TEXT;
