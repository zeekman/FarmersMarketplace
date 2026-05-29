'use strict';

const router = require('express').Router();
const { z } = require('zod');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const logger = require('../logger');

const MIN_MINUTES = parseInt(process.env.MIN_AUCTION_DURATION_MINUTES ?? '5', 10);

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues[0]?.message || 'Validation error';
      return err(res, 400, msg, 'validation_error');
    }
    req.body = result.data;
    next();
  };
}

const createAuctionSchema = z.object({
  product_id:    z.coerce.number().int().positive(),
  start_price:   z.coerce.number().positive(),
  reserve_price: z.coerce.number().positive().optional(),
  min_increment: z.coerce.number().min(0).optional().default(0),
  ends_at: z.string().datetime({ offset: true }).refine(
    (v) => new Date(v) >= new Date(Date.now() + MIN_MINUTES * 60 * 1000),
    `ends_at must be at least ${MIN_MINUTES} minutes in the future`
  ),
});

const bidSchema = z.object({
  amount: z.coerce.number().positive('amount must be a positive number'),
});

// ── POST /api/auctions ────────────────────────────────────────────────────────
router.post('/', auth, validateBody(createAuctionSchema), async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

  const { product_id, start_price, reserve_price, min_increment, ends_at } = req.body;

  try {
    const { rows: products } = await db.query(
      'SELECT id FROM products WHERE id = $1 AND farmer_id = $2',
      [product_id, req.user.id]
    );
    if (!products.length) return err(res, 404, 'Product not found or not yours', 'not_found');

    const { rows: existing } = await db.query(
      `SELECT id FROM auctions WHERE product_id = $1 AND status = 'active'`,
      [product_id]
    );
    if (existing.length)
      return err(res, 409, 'An active auction already exists for this product', 'conflict');

    const { rows } = await db.query(
      `INSERT INTO auctions (product_id, farmer_id, start_price, reserve_price, min_increment, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [product_id, req.user.id, start_price, reserve_price ?? null, min_increment, ends_at]
    );

    const auctionId = rows[0]?.id;
    logger.info('[auctions] Created auction', { auctionId, farmerId: req.user.id, product_id });
    res.status(201).json({ success: true, auctionId });
  } catch (e) {
    logger.error('[auctions] Create failed', { error: e.message });
    err(res, 500, 'Failed to create auction', 'internal_error');
  }
});

// ── GET /api/auctions ─────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.start_price, a.reserve_price, a.min_increment, a.current_bid,
              a.status, a.ends_at, a.created_at,
              p.name AS product_name, p.description, p.unit,
              u.name AS farmer_name,
              COUNT(b.id) AS bid_count
       FROM auctions a
       JOIN products p ON a.product_id = p.id
       JOIN users    u ON a.farmer_id  = u.id
       LEFT JOIN bids b ON b.auction_id = a.id
       WHERE a.status = 'active' AND a.ends_at > $1
       GROUP BY a.id, p.name, p.description, p.unit, u.name
       ORDER BY a.ends_at ASC`,
      [new Date().toISOString()]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error('[auctions] List failed', { error: e.message });
    err(res, 500, 'Failed to list auctions', 'internal_error');
  }
});

// ── GET /api/auctions/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.start_price, a.reserve_price, a.min_increment, a.current_bid,
              a.status, a.ends_at, a.closed_at, a.created_at,
              p.name AS product_name, p.description, p.unit,
              u.name AS farmer_name,
              COUNT(b.id) AS bid_count
       FROM auctions a
       JOIN products p ON a.product_id = p.id
       JOIN users    u ON a.farmer_id  = u.id
       LEFT JOIN bids b ON b.auction_id = a.id
       WHERE a.id = $1
       GROUP BY a.id, p.name, p.description, p.unit, u.name`,
      [req.params.id]
    );
    if (!rows.length) return err(res, 404, 'Auction not found', 'not_found');
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    logger.error('[auctions] Get failed', { error: e.message, auctionId: req.params.id });
    err(res, 500, 'Failed to get auction', 'internal_error');
  }
});

// ── POST /api/auctions/:id/bid ────────────────────────────────────────────────
router.post('/:id/bid', auth, validateBody(bidSchema), async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can bid', 'forbidden');

  const auctionId = parseInt(req.params.id, 10);
  if (!Number.isInteger(auctionId) || auctionId <= 0)
    return err(res, 400, 'Invalid auction id', 'validation_error');

  const { amount } = req.body;

  try {
    const result = await placeBid({ auctionId, buyerId: req.user.id, amount });
    if (!result.success) return err(res, result.status, result.message, result.code);

    logger.info('[auctions] Bid placed', {
      auctionId,
      buyerId: req.user.id,
      amount,
    });
    res.json({ success: true, message: 'Bid placed', currentBid: amount });
  } catch (e) {
    logger.error('[auctions] Bid failed', { error: e.message, auctionId });
    err(res, 500, 'Failed to place bid', 'internal_error');
  }
});

/**
 * Atomically validate and record a bid.
 * Returns { success, status, message, code } — never throws for business-rule failures.
 *
 * Locking strategy:
 *   PostgreSQL: SELECT … FOR UPDATE on the auction row serialises concurrent bids.
 *   SQLite:     better-sqlite3 transactions are serialised by the single-writer model.
 */
async function placeBid({ auctionId, buyerId, amount }) {
  if (db.isPostgres) {
    return placeBidPostgres({ auctionId, buyerId, amount });
  }
  return placeBidSqlite({ auctionId, buyerId, amount });
}

async function placeBidPostgres({ auctionId, buyerId, amount }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock the auction row for the duration of this transaction
    const { rows } = await client.query(
      `SELECT id, status, ends_at, start_price, current_bid, highest_bidder_id,
              min_increment, reserve_price, farmer_id
       FROM auctions WHERE id = $1 FOR UPDATE`,
      [auctionId]
    );

    const validation = validateBidRules(rows[0], buyerId, amount);
    if (!validation.ok) {
      await client.query('ROLLBACK');
      return validation;
    }

    await client.query(
      'INSERT INTO bids (auction_id, buyer_id, amount) VALUES ($1, $2, $3)',
      [auctionId, buyerId, amount]
    );
    await client.query(
      'UPDATE auctions SET current_bid = $1, highest_bidder_id = $2 WHERE id = $3',
      [amount, buyerId, auctionId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function placeBidSqlite({ auctionId, buyerId, amount }) {
  // SQLite transactions are synchronous and serialised — no explicit locking needed
  let result;
  db.transaction(() => {
    const auction = db
      .prepare(
        `SELECT id, status, ends_at, start_price, current_bid, highest_bidder_id,
                min_increment, reserve_price, farmer_id
         FROM auctions WHERE id = ?`
      )
      .get(auctionId);

    const validation = validateBidRules(auction, buyerId, amount);
    if (!validation.ok) {
      result = validation;
      return; // transaction body returns; better-sqlite3 will commit (no writes occurred)
    }

    db.prepare('INSERT INTO bids (auction_id, buyer_id, amount) VALUES (?, ?, ?)').run(
      auctionId, buyerId, amount
    );
    db.prepare(
      'UPDATE auctions SET current_bid = ?, highest_bidder_id = ? WHERE id = ?'
    ).run(amount, buyerId, auctionId);

    result = { success: true };
  })();
  return result;
}

/**
 * Pure validation — no DB side-effects.
 * Returns { ok: true } or { ok: false, success: false, status, message, code }.
 */
function validateBidRules(auction, buyerId, amount) {
  if (!auction) return fail(404, 'Auction not found', 'not_found');

  if (auction.status === 'cancelled')
    return fail(400, 'Auction has been cancelled', 'auction_cancelled');

  if (auction.status === 'closed')
    return fail(400, 'Auction has already closed', 'auction_closed');

  // Treat past end_time as closed even if the cron hasn't run yet
  if (new Date(auction.ends_at) <= new Date())
    return fail(400, 'Auction has ended', 'auction_ended');

  // Bidder eligibility: farmers cannot bid; bidder cannot be the auction owner
  if (auction.farmer_id === buyerId)
    return fail(403, 'Auction owner cannot bid on their own auction', 'forbidden');

  const floor = auction.current_bid ?? auction.start_price;
  const minRequired = floor + (auction.min_increment ?? 0);

  if (amount <= floor)
    return fail(400, `Bid must be greater than current bid of ${floor}`, 'bid_too_low');

  if (auction.min_increment > 0 && amount < minRequired)
    return fail(
      400,
      `Bid must be at least ${minRequired} (current bid + minimum increment of ${auction.min_increment})`,
      'bid_below_increment'
    );

  if (auction.highest_bidder_id === buyerId)
    return fail(400, 'You are already the highest bidder', 'already_highest');

  return { ok: true };
}

function fail(status, message, code) {
  return { ok: false, success: false, status, message, code };
}

module.exports = router;
// Export for testing
module.exports.validateBidRules = validateBidRules;
module.exports.placeBid = placeBid;
