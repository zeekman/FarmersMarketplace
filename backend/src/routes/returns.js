const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { burnRewardTokens } = require('../utils/stellar');
const logger = require('../logger');

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
      [order_id, req.user.id, reason]
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

    await db.query('UPDATE returns SET status = $1 WHERE id = $2', ['approved', ret.id]);

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
const { sendPayment } = require('../utils/stellar-payments');
const { sendReturnEmail } = require('../utils/mailer');

const RETURN_WINDOW_HOURS = parseInt(process.env.RETURN_WINDOW_HOURS || '48', 10);

// POST /api/returns — buyer submits a return request
router.post('/', auth, async (req, res) => {
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

  if (order.status !== 'delivered')
    return res.status(400).json({ error: 'Only delivered orders can be returned' });

  if (!order.delivered_at)
    return res.status(400).json({ error: 'Order delivery date is not recorded' });

  const deliveredAt = new Date(order.delivered_at).getTime();
  const windowMs = RETURN_WINDOW_HOURS * 60 * 60 * 1000;
  if (Date.now() > deliveredAt + windowMs)
    return res.status(400).json({ error: `Return window of ${RETURN_WINDOW_HOURS} hours has expired` });

  const { rows: existing } = await db.query(
    'SELECT id FROM returns WHERE order_id = $1',
    [order_id]
  );
  if (existing[0])
    return res.status(409).json({ error: 'Return request already submitted for this order' });

  const { rows: insertRows } = await db.query(
    'INSERT INTO returns (order_id, buyer_id, reason) VALUES ($1, $2, $3) RETURNING id',
    [order_id, req.user.id, reason]
  );
  // For SQLite the RETURNING clause may not work — fall back to last_insert_rowid
  let returnId = insertRows[0]?.id;
  if (!returnId && !db.isPostgres) {
    const { rows: last } = await db.query('SELECT last_insert_rowid() AS id');
    returnId = last[0]?.id;
  }

  // Notify farmer
  const { rows: detailRows } = await db.query(
    `SELECT o.*, p.name AS product_name,
            b.name AS buyer_name, b.email AS buyer_email,
            f.name AS farmer_name, f.email AS farmer_email
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users b ON o.buyer_id = b.id
     JOIN users f ON p.farmer_id = f.id
     WHERE o.id = $1`,
    [order_id]
  );
  const detail = detailRows[0];
  if (detail) {
    sendReturnEmail({
      type: 'filed',
      order: { id: detail.id, product_name: detail.product_name },
      buyer: { name: detail.buyer_name, email: detail.buyer_email },
      farmer: { name: detail.farmer_name, email: detail.farmer_email },
      reason,
    }).catch(() => {});
  }

  res.status(201).json({ id: returnId, message: 'Return request submitted' });
});

// GET /api/returns — buyer's own return requests
router.get('/', auth, async (req, res) => {
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
});

// PATCH /api/returns/:id/approve — farmer approves and issues XLM refund
router.patch('/:id/approve', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return res.status(403).json({ error: 'Only farmers can approve returns' });

  const { rows: retRows } = await db.query(
    `SELECT r.*,
            o.total_price, o.shipping_cost,
            o.id AS order_id,
            p.name AS product_name,
            b.stellar_public_key AS buyer_wallet,
            b.name AS buyer_name, b.email AS buyer_email,
            f.stellar_secret_key AS farmer_secret,
            f.name AS farmer_name
     FROM returns r
     JOIN orders o ON r.order_id = o.id
     JOIN products p ON o.product_id = p.id
     JOIN users b ON r.buyer_id = b.id
     JOIN users f ON p.farmer_id = f.id
     WHERE r.id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const ret = retRows[0];
  if (!ret) return res.status(404).json({ error: 'Return request not found or not yours' });
  if (ret.status !== 'pending')
    return res.status(400).json({ error: `Return already ${ret.status}` });

  if (!ret.buyer_wallet)
    return res.status(400).json({ error: 'Buyer has no Stellar address on file' });
  if (!ret.farmer_secret)
    return res.status(400).json({ error: 'Farmer Stellar wallet is not configured' });

  const refundAmount = parseFloat(ret.total_price) + parseFloat(ret.shipping_cost || 0);

  let txHash;
  try {
    txHash = await sendPayment({
      senderSecret: ret.farmer_secret,
      receiverPublicKey: ret.buyer_wallet,
      amount: refundAmount,
      memo: `Refund#${ret.id}`,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Refund transaction failed: ' + e.message });
  }

  await db.query(
    'UPDATE returns SET status = $1, refund_tx_hash = $2 WHERE id = $3',
    ['approved', txHash, ret.id]
  );

  sendReturnEmail({
    type: 'approved',
    order: { id: ret.order_id, product_name: ret.product_name, total_price: refundAmount },
    buyer: { name: ret.buyer_name, email: ret.buyer_email },
    farmer: { name: ret.farmer_name },
    txHash,
  }).catch(() => {});

  res.json({ message: 'Return approved and refund issued', refundAmount, txHash });
});

// PATCH /api/returns/:id/reject — farmer rejects with mandatory reason
router.patch('/:id/reject', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return res.status(403).json({ error: 'Only farmers can reject returns' });

  const { reason } = req.body;
  if (!reason || !reason.trim())
    return res.status(400).json({ error: 'A rejection reason is required' });

  const { rows: retRows } = await db.query(
    `SELECT r.*,
            o.id AS order_id,
            p.name AS product_name,
            b.name AS buyer_name, b.email AS buyer_email,
            f.name AS farmer_name
     FROM returns r
     JOIN orders o ON r.order_id = o.id
     JOIN products p ON o.product_id = p.id
     JOIN users b ON r.buyer_id = b.id
     JOIN users f ON p.farmer_id = f.id
     WHERE r.id = $1 AND p.farmer_id = $2`,
    [req.params.id, req.user.id]
  );
  const ret = retRows[0];
  if (!ret) return res.status(404).json({ error: 'Return request not found or not yours' });
  if (ret.status !== 'pending')
    return res.status(400).json({ error: `Return already ${ret.status}` });

  await db.query(
    'UPDATE returns SET status = $1, reject_reason = $2 WHERE id = $3',
    ['rejected', reason.trim(), ret.id]
  );

  sendReturnEmail({
    type: 'rejected',
    order: { id: ret.order_id, product_name: ret.product_name },
    buyer: { name: ret.buyer_name, email: ret.buyer_email },
    farmer: { name: ret.farmer_name },
    rejectReason: reason.trim(),
  }).catch(() => {});

  res.json({ message: 'Return request rejected' });
});

module.exports = router;
