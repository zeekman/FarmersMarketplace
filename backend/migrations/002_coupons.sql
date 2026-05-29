-- Migration: 002_coupons
-- Description: Add coupons table for farmer discount/promo codes

CREATE TABLE IF NOT EXISTS coupons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code           TEXT NOT NULL UNIQUE,
  discount_type  TEXT NOT NULL CHECK(discount_type IN ('percent', 'fixed')),
  discount_value REAL NOT NULL CHECK(discount_value > 0),
  max_uses       INTEGER,
  used_count     INTEGER NOT NULL DEFAULT 0,
  expires_at     DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
