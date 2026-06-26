const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendDisputeOpenedEmail, sendDisputeResolvedEmail } = require('../utils/mailer');
const { burnRewardTokens, invokeEscrowContract } = require('../utils/stellar');
const { sendPushToUser } = require('../utils/pushNotifications');
const logger = require('../logger');

const DISPUTE_WINDOW_HOURS = parseInt(process.env.DISPUTE_WINDOW_HOURS || '72', 10);

// POST /api/disputes — buyer files a dispute on a paid order
router.post('/', auth, validate.dispute, async (req, res, next) => {
  try {
    if (req.user.role !== 'buyer')
      return res.status(403).json({ error: 'Only buyers can file disputes' });

    const order_id = parseInt(req.body.order_id, 10);
    const { reason } = req.body;

    const { rows: orderRows } = await db.query(
      `SELECT o.*, u.stellar_public_key as farmer_wallet, u.id as farmer_id, u.email as farmer_email, u.name as farmer_name
       FROM orders o JOIN users u ON o.farmer_id = u.id
       WHERE o.id = $1 AND o.buyer_id = $2`,
      [order_id, req.user.id]
    );
    const order = orderRows[0];

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'paid')
      return res.status(400).json({ error: 'Disputes can only be filed on paid orders' });

    // Time window check
    const paidAt = new Date(order.updated_at || order.created_at);
    const windowMs = DISPUTE_WINDOW_HOURS * 60 * 60 * 1000;
    if (Date.now() - paidAt.getTime() > windowMs)
      return res.status(400).json({ error: `Disputes must be filed within ${DISPUTE_WINDOW_HOURS} hours of delivery` });

    const { rows: existingRows } = await db.query(
      'SELECT id FROM disputes WHERE order_id = $1',
      [order_id]
    );
    if (existingRows[0])
      return res.status(409).json({ error: 'A dispute already exists for this order' });

    const { rows: inserted } = await db.query(
      'INSERT INTO disputes (order_id, buyer_id, reason, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [order_id, req.user.id, reason.trim(), 'open']
    );
    const disputeId = inserted[0].id;

    // Call escrow contract to mark dispute on-chain (non-fatal)
    const { rows: buyerRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const buyer = buyerRows[0];
    if (buyer?.stellar_secret_key) {
      invokeEscrowContract({
        action: 'dispute',
        senderSecret: buyer.stellar_secret_key,
        orderId: order_id,
        buyerPublicKey: buyer.stellar_public_key,
        farmerPublicKey: order.farmer_wallet,
        userId: req.user.id,
      }).catch((e) => logger.warn('[disputes] escrow open_dispute failed (non-fatal):', e.message));
    }

    // Notify buyer
    sendPushToUser(req.user.id, { title: 'Dispute Filed', body: `Your dispute for order #${order_id} has been submitted.` })
      .catch(() => {});
    sendDisputeOpenedEmail({ buyer, order, farmerName: order.farmer_name, farmerEmail: order.farmer_email })
      .catch(() => {});
    // Notify farmer
    sendPushToUser(order.farmer_id, { title: 'Dispute Opened', body: `A dispute has been filed against order #${order_id}.` })
      .catch(() => {});

    res.status(201).json({ id: disputeId, order_id, status: 'open', message: 'Dispute filed' });
  } catch (err) {
    next(err);
  }
});

// GET /api/disputes — admin lists all disputes
router.get('/', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admins only' });

    const { rows } = await db.query(`
      SELECT d.*, u.name as buyer_name, u.email as buyer_email,
             o.total_price, o.quantity, p.name as product_name
      FROM disputes d
      JOIN users u ON d.buyer_id = u.id
      JOIN orders o ON d.order_id = o.id
      JOIN products p ON o.product_id = p.id
      ORDER BY d.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/disputes/:id/resolve — admin/arbitrator resolves a dispute
router.patch('/:id/resolve', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admins only' });

    const { rows: disputeRows } = await db.query(
      `SELECT d.*, o.farmer_id, o.total_price, o.product_id
       FROM disputes d JOIN orders o ON d.order_id = o.id
       WHERE d.id = $1`,
      [req.params.id]
    );
    const dispute = disputeRows[0];
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (dispute.status === 'resolved')
      return res.status(400).json({ error: 'Dispute already resolved' });

    const { resolution, split_percent_buyer } = req.body;
    if (!['buyer', 'farmer', 'split'].includes(resolution))
      return res.status(400).json({ error: "resolution must be 'buyer', 'farmer', or 'split'" });
    if (resolution === 'split') {
      if (split_percent_buyer == null || split_percent_buyer < 0 || split_percent_buyer > 100)
        return res.status(400).json({ error: 'split_percent_buyer must be 0-100' });
    }

    // Fetch parties
    const [{ rows: buyerRows }, { rows: farmerRows }] = await Promise.all([
      db.query('SELECT * FROM users WHERE id = $1', [dispute.buyer_id]),
      db.query('SELECT * FROM users WHERE id = $1', [dispute.farmer_id]),
    ]);
    const buyer = buyerRows[0];
    const farmer = farmerRows[0];

    // Invoke escrow resolve_dispute (non-fatal)
    const adminRows = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
    const adminSecret = adminRows.rows[0]?.stellar_secret_key;
    if (adminSecret) {
      const escrowPayload = {
        action: 'dispute',
        senderSecret: adminSecret,
        orderId: dispute.order_id,
        buyerPublicKey: buyer?.stellar_public_key,
        farmerPublicKey: farmer?.stellar_public_key,
        userId: req.user.id,
      };
      if (resolution === 'buyer') {
        invokeEscrowContract({ ...escrowPayload, action: 'refund' })
          .catch((e) => logger.warn('[disputes] escrow refund failed (non-fatal):', e.message));
      } else if (resolution === 'farmer') {
        invokeEscrowContract({ ...escrowPayload, action: 'release' })
          .catch((e) => logger.warn('[disputes] escrow release failed (non-fatal):', e.message));
      }
      // split: partial refund — call refund (best-effort, contract handles split_percent_buyer as hint)
      if (resolution === 'split') {
        invokeEscrowContract({ ...escrowPayload, action: 'refund', splitPercentBuyer: split_percent_buyer })
          .catch((e) => logger.warn('[disputes] escrow split refund failed (non-fatal):', e.message));
      }
    }

    await db.query(
      `UPDATE disputes SET status = 'resolved', resolution = $1, split_percent_buyer = $2 WHERE id = $3`,
      [resolution, resolution === 'split' ? split_percent_buyer : null, dispute.id]
    );

    const { rows: productRows } = await db.query('SELECT * FROM products WHERE id = $1', [dispute.product_id]);
    const product = productRows[0];
    const order = { id: dispute.order_id, total_price: dispute.total_price };

    // Notify both parties
    sendDisputeResolvedEmail({ dispute: { ...dispute, resolution }, order, product, buyer })
      .catch(() => {});
    sendPushToUser(dispute.buyer_id, { title: 'Dispute Resolved', body: `Your dispute for order #${dispute.order_id} was resolved: ${resolution}.` })
      .catch(() => {});
    sendPushToUser(dispute.farmer_id, { title: 'Dispute Resolved', body: `Dispute for order #${dispute.order_id} was resolved: ${resolution}.` })
      .catch(() => {});

    // Burn reward tokens (non-fatal)
    if (buyer?.stellar_public_key) {
      const burnAmount = Math.floor(Number(dispute.total_price));
      if (burnAmount > 0) {
        burnRewardTokens(buyer.stellar_public_key, burnAmount)
          .catch((e) => logger.warn('[Rewards] Burn failed on dispute resolve (non-fatal):', { error: e.message }));
      }
    }

    res.json({ id: dispute.id, status: 'resolved', resolution, message: 'Dispute resolved' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
