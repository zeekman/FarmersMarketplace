-- Migration: 032_payment_streams
-- Issue #996: mirrors contracts/escrow/src/stream.rs's on-chain PaymentStream
-- record so the backend can list "your active payment streams" without
-- querying the chain on every page load.
--
-- stream_id is a per-contract counter (StreamKey::Stream(u64) on-chain), so
-- it is only unique together with contract_id. The unique index below is
-- what the eventual indexer job upserts against:
--   INSERT INTO payment_streams (...) VALUES (...)
--   ON CONFLICT (contract_id, stream_id) DO UPDATE SET ...

CREATE TABLE IF NOT EXISTS payment_streams (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id           TEXT     NOT NULL,
  stream_id             INTEGER  NOT NULL,
  sender                TEXT     NOT NULL,
  recipient             TEXT     NOT NULL,
  rate_per_second       REAL     NOT NULL,
  deposit               REAL     NOT NULL,
  accrued_at_checkpoint REAL     NOT NULL DEFAULT 0,
  last_checkpoint_at    INTEGER  NOT NULL DEFAULT 0,
  end_time              INTEGER  NOT NULL,
  cancelled             INTEGER  NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_streams_contract_stream
  ON payment_streams (contract_id, stream_id);

CREATE INDEX IF NOT EXISTS idx_payment_streams_sender    ON payment_streams (sender);
CREATE INDEX IF NOT EXISTS idx_payment_streams_recipient ON payment_streams (recipient);
