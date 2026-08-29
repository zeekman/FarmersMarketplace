-- Migration: 003_price_tiers
-- Description: Add price_tiers table for wholesale pricing

CREATE TABLE IF NOT EXISTS price_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  min_quantity INTEGER NOT NULL CHECK(min_quantity > 0),
  price_per_unit REAL NOT NULL CHECK(price_per_unit > 0),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE(product_id, min_quantity)
);