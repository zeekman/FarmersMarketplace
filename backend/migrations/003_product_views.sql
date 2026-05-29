-- Migration: 003_product_views
-- Description: Track anonymous product views for recommendations/trending

CREATE TABLE IF NOT EXISTS product_views (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id, date(viewed_at))
);
