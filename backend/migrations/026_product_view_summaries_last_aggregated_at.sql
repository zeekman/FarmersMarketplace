-- Migration: 026_product_view_summaries_last_aggregated_at
-- Description: Add last_aggregated_at to product_view_summaries to track incremental aggregation window

ALTER TABLE product_view_summaries ADD COLUMN last_aggregated_at DATETIME;
