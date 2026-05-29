-- Migration: 016_coupon_uses
-- Description: Track per-user coupon redemptions and add max_uses_per_user limit

ALTER TABLE coupons ADD COLUMN max_uses_per_user INTEGER;

CREATE TABLE IF NOT EXISTS coupon_uses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id  INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coupon_uses_coupon_user ON coupon_uses(coupon_id, user_id);
