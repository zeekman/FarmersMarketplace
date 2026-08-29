-- Migration: 011_price_history
CREATE TABLE IF NOT EXISTS price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price       REAL NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
