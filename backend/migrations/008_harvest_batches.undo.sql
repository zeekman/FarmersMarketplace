-- Undo: 008_harvest_batches

DROP INDEX IF EXISTS idx_products_batch_id;
DROP INDEX IF EXISTS idx_harvest_batches_farmer;

-- SQLite cannot DROP COLUMN easily; PostgreSQL can — keep minimal undo for PG
ALTER TABLE products DROP COLUMN IF EXISTS batch_id;

DROP TABLE IF EXISTS harvest_batches;
