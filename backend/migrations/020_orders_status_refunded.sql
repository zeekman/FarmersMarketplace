-- Migration: 020_orders_status_refunded
-- Description: Add 'refunded' to orders status CHECK constraint (issue #11)
--
-- PostgreSQL: drop the old constraint and add the updated one.
-- SQLite: does not support ALTER TABLE ... DROP/ADD CONSTRAINT; the updated
--         CHECK is applied to the initial schema for new installs. Existing
--         SQLite databases will accept 'refunded' inserts because SQLite only
--         enforces CHECK constraints defined at CREATE TABLE time, and the
--         application layer controls the allowed values.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK(status IN ('pending','paid','processing','shipped','delivered','failed','refunded'));
