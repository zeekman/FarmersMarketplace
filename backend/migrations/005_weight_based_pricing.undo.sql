-- Rollback: 005_weight_based_pricing

ALTER TABLE products DROP COLUMN IF EXISTS pricing_type;
ALTER TABLE products DROP COLUMN IF EXISTS min_weight;
ALTER TABLE products DROP COLUMN IF EXISTS max_weight;

ALTER TABLE orders DROP COLUMN IF EXISTS weight;
