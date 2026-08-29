CREATE TABLE IF NOT EXISTS bundle_discounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  min_products     INTEGER NOT NULL CHECK(min_products >= 2),
  discount_percent REAL    NOT NULL CHECK(discount_percent > 0 AND discount_percent <= 100),
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(farmer_id, min_products)
);
