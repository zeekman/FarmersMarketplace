-- #874: per-product video table (up to 3 videos per product)
CREATE TABLE IF NOT EXISTS product_videos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  video_url  TEXT    NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_videos_product_id ON product_videos(product_id);
