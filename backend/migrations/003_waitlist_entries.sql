-- Migration: 003_waitlist_entries
-- Description: Add waitlist_entries table for product waitlist functionality

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(buyer_id, product_id),
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_waitlist_product_position ON waitlist_entries(product_id, position);
CREATE INDEX idx_waitlist_buyer ON waitlist_entries(buyer_id);