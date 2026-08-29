-- Add full-text search vector column and GIN index to products table (PostgreSQL only)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS products_search_vector_gin
  ON products USING GIN (search_vector);
