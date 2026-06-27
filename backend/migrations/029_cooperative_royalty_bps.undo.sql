-- Undo: 029_cooperative_royalty_bps
-- SQLite does not support DROP COLUMN on older versions; recreate the table.
-- For PostgreSQL environments a simple ALTER TABLE DROP COLUMN suffices.

-- PostgreSQL:
ALTER TABLE cooperatives DROP COLUMN IF EXISTS royalty_bps;
