-- Migration: 023_auctions_and_bids
-- Creates auctions and bids tables with all columns needed for
-- server-side bid validation and auto-closure.

CREATE TABLE IF NOT EXISTS auctions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  farmer_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  start_price       REAL    NOT NULL CHECK(start_price > 0),
  reserve_price     REAL,
  min_increment     REAL    NOT NULL DEFAULT 0,
  current_bid       REAL,
  highest_bidder_id INTEGER REFERENCES users(id),
  status            TEXT    NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','closed','cancelled')),
  ends_at           DATETIME NOT NULL,
  closed_at         DATETIME,
  winner_notified   INTEGER NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auctions_status_ends_at
  ON auctions (status, ends_at);

CREATE TABLE IF NOT EXISTS bids (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  buyer_id   INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  amount     REAL    NOT NULL CHECK(amount > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids (auction_id);
CREATE INDEX IF NOT EXISTS idx_bids_buyer_id   ON bids (buyer_id);
