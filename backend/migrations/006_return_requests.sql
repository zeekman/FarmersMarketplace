-- Migration: 006_return_requests
-- Description: Add return_requests table for buyer refund requests

CREATE TABLE IF NOT EXISTS return_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  refund_tx_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
