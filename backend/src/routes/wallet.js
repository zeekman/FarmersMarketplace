const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { getBalance, getTransactions, fundTestnetAccount, sendPayment, server } = require('../utils/stellar');
const stellar = require('../utils/stellar');
const { getBalance, getAllBalances, getTransactions, fundTestnetAccount, sendPayment, addTrustline, removeTrustline } = stellar;
const { lookupFederationAddress } = stellar;
const { err } = require('../middleware/error');

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Stellar wallet operations
 */

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     summary: Get wallet balance and public key
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 publicKey: { type: string }
 *                 balance: { type: number, description: XLM balance }
 *                 referralCode: { type: string }
 */
// GET /api/wallet
router.get('/', auth, async (req, res) => {
  const { rows } = await db.query('SELECT stellar_public_key, referral_code FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  const [balance, balances] = await Promise.all([
    getBalance(user.stellar_public_key),
    getAllBalances(user.stellar_public_key),
  ]);
  res.json({ success: true, publicKey: user.stellar_public_key, balance, balances, referralCode: user.referral_code });
});

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get transaction history for the wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Stellar transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       type: { type: string }
 *                       amount: { type: string }
 *                       created_at: { type: string, format: date-time }
 */
// GET /api/wallet/transactions
router.get('/transactions', auth, async (req, res) => {
  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [req.user.id]);
  const txs = await getTransactions(rows[0].stellar_public_key);

  // Enrich each tx with federation addresses (failures are silently ignored)
  const enriched = await Promise.all(txs.map(async (tx) => {
    const [fromFederation, toFederation] = await Promise.all([
      lookupFederationAddress(tx.from),
      lookupFederationAddress(tx.to),
    ]);
    return {
      ...tx,
      from_federation: fromFederation || null,
      to_federation: toFederation || null,
    };
  }));

  res.json({ success: true, data: enriched });
});

// GET /api/wallet/stream — SSE endpoint for real-time payment notifications
// EventSource cannot set custom headers, so we accept the JWT as a query param here only.
router.get('/stream', (req, res) => {
  // Verify token from query string
  const token = req.query.token;
  if (!token) return err(res, 401, 'No token provided', 'missing_token');

  let userId;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    userId = payload.id;
  } catch {
    return err(res, 401, 'Invalid token', 'invalid_token');
  }

  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(userId);
  if (!user) return err(res, 404, 'User not found', 'user_not_found');

  const publicKey = user.stellar_public_key;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
  res.flushHeaders();

  // Send a heartbeat comment every 25s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  // Start streaming payments from Horizon
  let stopStream = null;

  try {
    stopStream = server
      .payments()
      .forAccount(publicKey)
      .cursor('now') // only new payments from this point forward
      .stream({
        onmessage: async (payment) => {
          // Only care about native XLM payments received by this account
          if (payment.type !== 'payment') return;
          if (payment.asset_type !== 'native') return;
          if (payment.to !== publicKey) return;

          try {
            const balance = await getBalance(publicKey);
            const data = JSON.stringify({
              type: 'payment',
              amount: payment.amount,
              from: payment.from,
              transactionHash: payment.transaction_hash,
              balance,
            });
            res.write(`data: ${data}\n\n`);
          } catch {
            // If balance fetch fails, still notify with the payment info
            const data = JSON.stringify({
              type: 'payment',
              amount: payment.amount,
              from: payment.from,
              transactionHash: payment.transaction_hash,
              balance: null,
            });
            res.write(`data: ${data}\n\n`);
          }
        },
        onerror: (_streamErr) => {
          // Write an error event so the client can handle it, then close
          res.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream error' })}\n\n`);
          cleanup();
        },
      });
  } catch (e) {
    cleanup();
    return;
  }

  function cleanup() {
    clearInterval(heartbeat);
    if (typeof stopStream === 'function') {
      try { stopStream(); } catch {}
    }
    if (!res.writableEnded) res.end();
  }

  // Clean up when the client disconnects
  req.on('close', cleanup);
});

// POST /api/wallet/fund - testnet only
router.post('/fund', auth, async (req, res) => {
  if (process.env.STELLAR_NETWORK !== 'testnet') return err(res, 400, 'Only available on testnet', 'testnet_only');

  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
/**
 * @swagger
 * /api/wallet/fund:
 *   post:
 *     summary: Fund wallet via Stellar Friendbot (testnet only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account funded with 10,000 XLM
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 balance: { type: number }
 *       400:
 *         description: Only available on testnet
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
// POST /api/wallet/fund
router.post('/fund', auth, async (req, res) => {
  if (!stellar.isTestnet) return err(res, 400, 'Only available on testnet', 'testnet_only');
  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [req.user.id]);
  try {
    await fundTestnetAccount(rows[0].stellar_public_key);
    const balance = await getBalance(rows[0].stellar_public_key);
    res.json({ success: true, message: 'Account funded with 10,000 XLM (testnet)', balance });
  } catch (e) {
    err(res, 500, e.message, 'fund_failed');
  }
});

// POST /api/wallet/send
router.post('/send', auth, validate.sendXLM, async (req, res) => {
  const { destination, memo } = req.body;
  const amount = parseFloat(req.body.amount);

  const { rows } = await db.query('SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];

  if (destination === user.stellar_public_key)
    return res.status(400).json({ error: 'Cannot send XLM to your own wallet' });

  const balance = await getBalance(user.stellar_public_key);
  const required = amount + 0.00001;
  if (balance < required)
    return res.status(402).json({ error: 'Insufficient XLM balance', required: required.toFixed(7), available: balance.toFixed(7) });

  try {
    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: memo || '',
    });
    const txHash = await sendPayment({ senderSecret: user.stellar_secret_key, receiverPublicKey: destination, amount, memo: memo || '' });
    res.json({ txHash, amount, destination, memo: memo || null });
  } catch (e) {
    const stellarMsg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    res.status(502).json({ error: `Stellar transaction failed: ${stellarMsg}` });
  }
});

// GET /api/wallet/assets — list buyer's non-native (custom asset) balances
router.get('/assets', auth, async (req, res) => {
  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [req.user.id]);
  const balances = await getAllBalances(rows[0].stellar_public_key);
  const assets = balances.filter(b => b.asset_type !== 'native');
  res.json({ success: true, data: assets });
});

// GET /api/wallet/path-estimate?source_code=USDC&source_issuer=G...&dest_amount=10
// Returns estimated source amount needed to deliver dest_amount XLM
router.get('/path-estimate', auth, async (req, res) => {
  const { source_code, source_issuer, dest_amount } = req.query;
  if (!source_code || !source_issuer || !dest_amount)
    return err(res, 400, 'source_code, source_issuer, and dest_amount are required', 'validation_error');
  const destAmt = parseFloat(dest_amount);
  if (isNaN(destAmt) || destAmt <= 0)
    return err(res, 400, 'dest_amount must be a positive number', 'validation_error');

  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const estimate = await stellar.getPathPaymentEstimate({
      sourceAssetCode: source_code,
      sourceAssetIssuer: source_issuer,
      destPublicKey: rows[0].stellar_public_key,
      destAmount: destAmt,
    });
    res.json({ success: true, sourceAmount: estimate.sourceAmount, sourceCode: source_code });
  } catch (e) {
    if (e.code === 'no_path') return err(res, 404, e.message, 'no_path');
    err(res, 502, e.message, 'estimate_failed');
  }
});

// POST /api/wallet/trustline — add a trustline for a custom asset
router.post('/trustline', auth, async (req, res) => {
  const { asset_code, asset_issuer } = req.body;
  if (!asset_code || !asset_issuer) return err(res, 400, 'asset_code and asset_issuer are required', 'validation_error');
  if (!/^[A-Z0-9]{1,12}$/.test(asset_code)) return err(res, 400, 'Invalid asset_code', 'validation_error');
  if (!/^G[A-Z2-7]{55}$/.test(asset_issuer)) return err(res, 400, 'Invalid asset_issuer', 'validation_error');

  const { rows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const txHash = await addTrustline({ secret: rows[0].stellar_secret_key, assetCode: asset_code, assetIssuer: asset_issuer });
    res.json({ success: true, txHash });
  } catch (e) {
    const stellarMsg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    err(res, 502, `Trustline failed: ${stellarMsg}`, 'trustline_failed');
  }
});

// DELETE /api/wallet/trustline — remove a trustline (balance must be zero)
router.delete('/trustline', auth, async (req, res) => {
  const { asset_code, asset_issuer } = req.body;
  if (!asset_code || !asset_issuer) return err(res, 400, 'asset_code and asset_issuer are required', 'validation_error');

  const { rows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  try {
    const txHash = await removeTrustline({ secret: rows[0].stellar_secret_key, assetCode: asset_code, assetIssuer: asset_issuer });
    res.json({ success: true, txHash });
  } catch (e) {
    if (e.code === 'non_zero_balance') return err(res, 400, e.message, 'non_zero_balance');
    const stellarMsg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    err(res, 502, `Remove trustline failed: ${stellarMsg}`, 'trustline_failed');
  }
});

module.exports = router;
