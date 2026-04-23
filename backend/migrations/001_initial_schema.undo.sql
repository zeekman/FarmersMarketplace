-- Rollback: 001_initial_schema
-- WARNING: This drops all tables and all data.

DROP TABLE IF EXISTS stock_alerts;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS product_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
