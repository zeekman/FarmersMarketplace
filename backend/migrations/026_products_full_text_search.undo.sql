DROP INDEX IF EXISTS products_search_vector_gin;
ALTER TABLE products DROP COLUMN IF EXISTS search_vector;
