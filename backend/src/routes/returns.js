const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { burnRewardTokens } = require('../utils/stellar');
const logger = require('../logger');
const { sanitizeText } = require('../utils/sanitize');

// POST /api/returns - buyer submits a return request
router.post('/', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'buyer')
      return res.status(403).json({ error: 'Only buyers can request returns' });

    const { order_id, reason } = req.body;
    if (!order_id || !reason)
      return res.status(400).json({ error: 'order_id and reason required' });

    const { rows: orderRows } = await db.query(
      'SELECT * FROM orders WHERE id = $1 AND buyer_id = $2',
      [order_id, req.user.id]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'paid')
      return res.status(400).json({ error: 'Only paid orders can be returned' });

    const { rows: existingRows } = await db.query(
      'SELECT id FROM returns WHERE order_id = $1',
      [order_id]
    );
    if (existingRows[0])
      return res.status(409).json({ error: 'Return request already submitted for this order' });

    const { rows: inserted } = await db.query(
      'INSERT INTO returns (order_id, buyer_id, reason) VALUES ($1, $2, $3) RETURNING id',
      [order_id, req.user.id, sanitizeText(reason)]
    );

    res.status(201).json({ id: inserted[0].id, message: 'Return request submitted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/returns - buyer's own return requests
router.get('/', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'buyer')
      return res.status(403).json({ error: 'Only buyers can view their returns' });

    const { rows } = await db.query(
      `SELECT r.*, p.name AS product_name, o.total_price, o.shipping_cost, o.quantity
       FROM returns r
       JOIN orders o ON r.order_id = o.id
       JOIN products p ON o.product_id = p.id
       WHERE r.buyer_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/returns/:id/approve - admin approves a return (triggers burn of buyer's reward tokens)
router.patch('/:id/approve', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admins only' });

    const { rows: returnRows } = await db.query(
      'SELECT r.*, u.stellar_public_key FROM returns r JOIN users u ON r.buyer_id = u.id WHERE r.id = $1',
      [req.params.id]
    );
    const ret = returnRows[0];
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    if (ret.status !== 'pending')
      return res.status(409).json({ error: 'Return has already been processed', code: 'return_already_processed' });

    // The status predicate makes the transition atomic: only the request that
    // changes pending → approved may continue to the reward-token burn.
    const { rows: approvedRows, rowCount: approvedCount } = await db.query(
      'UPDATE returns SET status = $1 WHERE id = $2 AND status = $3 RETURNING id',
      ['approved', ret.id, 'pending']
    );
    if (!approvedRows[0] && !(approvedCount > 0))
      return res.status(409).json({ error: 'Return has already been processed', code: 'return_already_processed' });

    // #847 — burn reward tokens earned for this order (non-fatal)
    if (ret.stellar_public_key) {
      const { rows: orderRows } = await db.query(
        'SELECT total_price FROM orders WHERE id = $1',
        [ret.order_id]
      );
      const burnAmount = orderRows[0] ? Math.floor(Number(orderRows[0].total_price)) : 0;
      if (burnAmount > 0) {
        try {
          burnRewardTokens(ret.stellar_public_key, burnAmount)
            .catch((e) => logger.warn('[Rewards] Burn failed on return (non-fatal):', { error: e.message }));
        } catch (e) {
          logger.warn('[Rewards] Burn failed on return (non-fatal):', { error: e.message });
        }
      }
    }

    res.json({ id: ret.id, status: 'approved', message: 'Return approved' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;