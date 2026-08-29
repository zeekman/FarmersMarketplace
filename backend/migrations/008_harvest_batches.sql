-- Migration: 008_harvest_batches
-- Harvest batch tracking for product quality / recall

CREATE TABLE IF NOT EXISTS harvest_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_code    TEXT NOT NULL,
  harvest_date  TEXT NOT NULL,
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (farmer_id, batch_code)
);

ALTER TABLE products ADD COLUMN batch_id INTEGER REFERENCES harvest_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_harvest_batches_farmer ON harvest_batches(farmer_id);
CREATE INDEX IF NOT EXISTS idx_products_batch_id ON products(batch_id);
