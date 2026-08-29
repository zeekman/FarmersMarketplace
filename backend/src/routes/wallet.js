const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const stellar = require('../utils/stellar');
const { getBalance, getTransactions, fundTestnetAccount, sendPayment, server } = stellar;
const { err } = require('../middleware/error');

router.get('/', auth, async (req, res) => {
  const { rows } = await db.query('SELECT stellar_public_key, referral_code FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  const balance = await getBalance(user.stellar_public_key);
  res.json({ success: true, publicKey: user.stellar_public_key, balance, referralCode: user.referral_code });
});

router.get('/transactions', auth, async (req, res) => {
  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [req.user.id]);
  const txs = await getTransactions(rows[0].stellar_public_key);
  res.json({ success: true, data: txs });
});

router.get('/stream', (req, res) => {
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
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  let stopStream = null;

  try {
    stopStream = server
      .payments()
      .forAccount(publicKey)
      .cursor('now')
      .stream({
        onmessage: async (payment) => {
          if (payment.type !== 'payment') return;
          if (payment.asset_type !== 'native') return;
          if (payment.to !== publicKey) return;

          try {
            const balance = await getBalance(publicKey);
            const data = JSON.stringify({ type: 'payment', amount: payment.amount, from: payment.from, transactionHash: payment.transaction_hash, balance });
            res.write(`data: ${data}\n\n`);
          } catch {
            const data = JSON.stringify({ type: 'payment', amount: payment.amount, from: payment.from, transactionHash: payment.transaction_hash, balance: null });
            res.write(`data: ${data}\n\n`);
          }
        },
        onerror: () => {
          res.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream error' })}\n\n`);
          cleanup();
        },
      });
  } catch (_e) {
    cleanup();
    return;
  }

  function cleanup() {
    clearInterval(heartbeat);
    if (typeof stopStream === 'function') {
      try { stopStream(); } catch (_err) {}
    }
    if (!res.writableEnded) res.end();
  }

  req.on('close', cleanup);
});

router.post('/fund', auth, async (req, res) => {
  if (!stellar.isTestnet) return err(res, 400, 'Only available on testnet', 'testnet_only');

  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [req.user.id]);
  try {
    await fundTestnetAccount(rows[0].stellar_public_key);
    const balance = await getBalance(rows[0].stellar_public_key);
    res.json({ success: true, message: 'Account funded with 10,000 XLM (testnet)', balance });
  } catch (e) {
    return err(res, 500, e.message, 'fund_failed');
  }
});

router.post('/send', auth, validate.sendXLM, async (req, res) => {
  const { destination, memo } = req.body;
  const amount = parseFloat(req.body.amount);

  const { rows } = await db.query('SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];

  if (destination === user.stellar_public_key) {
    return res.status(400).json({ error: 'Cannot send XLM to your own wallet' });
  }

  const balance = await getBalance(user.stellar_public_key);
  const required = amount + 0.00001;
  if (balance < required) {
    return res.status(402).json({ error: 'Insufficient XLM balance', required: required.toFixed(7), available: balance.toFixed(7) });
  }

  try {
    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: memo || '',
    });
    res.json({ txHash, amount, destination, memo: memo || null });
  } catch (e) {
    const stellarMsg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    return res.status(502).json({ error: `Stellar transaction failed: ${stellarMsg}` });
  }
});

module.exports = router;

