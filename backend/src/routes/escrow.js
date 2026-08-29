const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../db/schema');
const { getEscrowState } = require('../utils/stellar');
const { err } = require('../middleware/error');

// Escrow state changes infrequently, so responses are cached briefly (30s TTL)
// to avoid hammering the Soroban RPC for repeated status checks.
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

// GET /api/escrow/:orderId/state  (authenticated)
// Returns a human-readable escrow status for a single order. Buyers may query
// their own orders, farmers orders for their products, and admins any order.
router.get('/:orderId/state', auth, async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return err(res, 400, 'Invalid orderId', 'invalid_order_id');
  }

  // Scope access to the caller's relationship with the order.
  const { rows } = await db.query(
    `SELECT o.id, o.buyer_id, p.farmer_id
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'order_not_found');

  const isAdmin = req.user.role === 'admin';
  const isBuyer = order.buyer_id === req.user.id;
  const isFarmer = order.farmer_id === req.user.id;
  if (!isAdmin && !isBuyer && !isFarmer) {
    return err(res, 403, 'Access denied', 'forbidden');
  }

  const cached = cache.get(orderId);
  if (cached && cached.expires > Date.now()) {
    return res.json({ success: true, data: cached.data });
  }

  try {
    const escrow = await getEscrowState(orderId);
    if (!escrow) {
      return err(res, 404, 'Escrow record not found on-chain', 'escrow_not_found');
    }

    const data = {
      status: escrow.status,
      buyer: escrow.buyer,
      farmer: escrow.farmer,
      amount_xlm: escrow.amount,
      timeout_at: escrow.timeoutUnix ? new Date(escrow.timeoutUnix * 1000).toISOString() : null,
      escrow_address: escrow.escrowAddress,
      last_updated_ledger: escrow.lastUpdatedLedger,
    };

    cache.set(orderId, { data, expires: Date.now() + CACHE_TTL_MS });
    res.json({ success: true, data });
  } catch (error) {
    err(res, 500, `Failed to fetch escrow state: ${error.message}`, 'rpc_error');
  }
});

module.exports = router;
