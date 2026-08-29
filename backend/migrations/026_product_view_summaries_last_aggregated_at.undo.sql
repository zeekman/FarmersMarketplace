-- Undo: 026_product_view_summaries_last_aggregated_at
ALTER TABLE product_view_summaries DROP COLUMN IF EXISTS last_aggregated_at;
