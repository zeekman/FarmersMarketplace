-- Rollback: 022_product_view_summaries
DROP INDEX IF EXISTS idx_pvs_product_date;
DROP INDEX IF EXISTS idx_pvs_view_date;
DROP TABLE IF EXISTS product_view_summaries;
