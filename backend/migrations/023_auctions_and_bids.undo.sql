-- Rollback: 023_auctions_and_bids
DROP INDEX IF EXISTS idx_bids_buyer_id;
DROP INDEX IF EXISTS idx_bids_auction_id;
DROP TABLE IF EXISTS bids;
DROP INDEX IF EXISTS idx_auctions_status_ends_at;
DROP TABLE IF EXISTS auctions;
