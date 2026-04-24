const router = require('express').Router();
const { z } = require('zod');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { sendPayment, getBalance } = require('../utils/stellar');
const { err } = require('../middleware/error');

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
  product_id: z.coerce.number().int().positive(),
  start_price: z.coerce.number().positive(),
  ends_at: z.iso
    .datetime({ offset: true })
    .refine(
      (v) => new Date(v) >= new Date(Date.now() + MIN_MINUTES * 60 * 1000),
      `ends_at must be at least ${MIN_MINUTES} minutes in the future`
    ),
});

// POST /api/auctions - farmer creates auction
router.post('/', auth, validateBody(createAuctionSchema), (req, res) => {
    if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');

    const { product_id, start_price, ends_at } = req.body;

    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?')
      .get(product_id, req.user.id);
    if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

    const existing = db
      .prepare(`SELECT id FROM auctions WHERE product_id = ? AND status = 'active'`)
      .get(product_id);
    if (existing)
      return err(res, 409, 'An active auction already exists for this product', 'conflict');

    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO auctions (product_id, farmer_id, start_price, ends_at) VALUES (?, ?, ?, ?)'
      )
      .run(product_id, req.user.id, start_price, ends_at);

    res.status(201).json({ success: true, auctionId: lastInsertRowid });
});

// GET /api/auctions - list active auctions
router.get('/', (req, res) => {
  const auctions = db
    .prepare(
      `
    SELECT a.*, p.name as product_name, p.description, p.unit, u.name as farmer_name,
           COUNT(b.id) as bid_count
    FROM auctions a
    JOIN products p ON a.product_id = p.id
    JOIN users u ON a.farmer_id = u.id
    LEFT JOIN bids b ON b.auction_id = a.id
    WHERE a.status = 'active' AND a.ends_at > datetime('now')
    GROUP BY a.id
    ORDER BY a.ends_at ASC
  `
    )
    .all();
  res.json({ success: true, data: auctions });
});

// POST /api/auctions/:id/bid - buyer places a bid
router.post(
  '/:id/bid',
  auth,
  validate([body('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number')]),
  async (req, res) => {
    if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can bid', 'forbidden');

    const auction = db
      .prepare(
        `
    SELECT a.*, u.stellar_public_key as farmer_wallet
    FROM auctions a JOIN users u ON a.farmer_id = u.id
    WHERE a.id = ?
  `
      )
      .get(req.params.id);

    if (!auction) return err(res, 404, 'Auction not found', 'not_found');
    if (auction.status !== 'active')
      return err(res, 400, 'Auction is not active', 'auction_closed');
    if (new Date(auction.ends_at) <= new Date())
      return err(res, 400, 'Auction has ended', 'auction_ended');

    const { amount } = req.body;
    const minBid = auction.current_bid ?? auction.start_price;
    if (amount <= minBid)
      return err(res, 400, `Bid must be higher than current bid of ${minBid} XLM`, 'bid_too_low');

    if (auction.highest_bidder_id === req.user.id)
      return err(res, 400, 'You are already the highest bidder', 'already_highest');

    db.prepare('INSERT INTO bids (auction_id, buyer_id, amount) VALUES (?, ?, ?)').run(
      auction.id,
      req.user.id,
      amount
    );
    db.prepare('UPDATE auctions SET current_bid = ?, highest_bidder_id = ? WHERE id = ?').run(
      amount,
      req.user.id,
      auction.id
    );

    res.json({ success: true, message: 'Bid placed', currentBid: amount });
  }
);

// GET /api/auctions/:id - single auction detail
router.get('/:id', (req, res) => {
  const auction = db
    .prepare(
      `
    SELECT a.*, p.name as product_name, p.description, p.unit, u.name as farmer_name,
           COUNT(b.id) as bid_count
    FROM auctions a
    JOIN products p ON a.product_id = p.id
    JOIN users u ON a.farmer_id = u.id
    LEFT JOIN bids b ON b.auction_id = a.id
    WHERE a.id = ?
    GROUP BY a.id
  `
    )
    .get(req.params.id);
  if (!auction) return err(res, 404, 'Auction not found', 'not_found');
  res.json({ success: true, data: auction });
});

module.exports = router;
