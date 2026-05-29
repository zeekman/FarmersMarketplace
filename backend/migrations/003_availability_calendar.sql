CREATE TABLE IF NOT EXISTS availability_calendar (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  week_start DATE NOT NULL,
  available  INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, week_start),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
