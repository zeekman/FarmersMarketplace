-- Migration 026: Add winner_id to auctions and support ended/ended_no_sale statuses

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS winner_id INTEGER REFERENCES users(id);

-- PostgreSQL: update the status check constraint to allow new statuses
DO $$ BEGIN
  ALTER TABLE auctions DROP CONSTRAINT IF EXISTS auctions_status_check;
  ALTER TABLE auctions ADD CONSTRAINT auctions_status_check
    CHECK (status IN ('active','closed','cancelled','ended','ended_no_sale'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
