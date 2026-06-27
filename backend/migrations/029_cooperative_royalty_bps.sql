-- Migration: 029_cooperative_royalty_bps
-- Issue #860: Store royalty rate (basis points) on the cooperatives table
-- so it can be passed into escrow deposits and applied on release.
--
-- royalty_bps: royalty paid to the cooperative treasury on every escrow release,
--              expressed in basis points (e.g. 500 = 5%).  Default 0 = no royalty.

ALTER TABLE cooperatives ADD COLUMN royalty_bps INTEGER NOT NULL DEFAULT 0;
