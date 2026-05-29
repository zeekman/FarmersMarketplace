-- Migration: 022_product_view_summaries
-- Description: Daily aggregation summary table for product_views analytics
--
-- Idempotent: INSERT OR REPLACE (SQLite) / INSERT ... ON CONFLICT DO UPDATE (PG)
-- ensures reruns reconcile existing rows without duplicates.

CREATE TABLE IF NOT EXISTS product_view_summaries (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  view_date   DATE    NOT NULL,
  view_count  INTEGER NOT NULL DEFAULT 0,
  unique_viewers INTEGER NOT NULL DEFAULT 0,
  aggregated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, view_date)
);

CREATE INDEX IF NOT EXISTS idx_pvs_view_date    ON product_view_summaries (view_date);
CREATE INDEX IF NOT EXISTS idx_pvs_product_date ON product_view_summaries (product_id, view_date);
