-- Undo: 002_soroban_push_video

DROP TABLE IF EXISTS push_subscriptions;
-- SQLite cannot drop columns directly; products.video_url is kept on rollback.
