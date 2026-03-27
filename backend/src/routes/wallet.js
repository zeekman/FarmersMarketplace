const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  getBalance,
  getTransactions,
  fundTestnetAccount,
  sendPayment,
  isTestnet,
} = require('../utils/stellar');
const { err } = require('../middleware/error');

// GET /api/wallet
router.get('/', auth, async (req, res) => {
  const user = db
    .prepare('SELECT stellar_public_key, referral_code FROM users WHERE id = ?')
    .get(req.user.id);
  const balance = await getBalance(user.stellar_public_key);
  res.json({
    success: true,
    publicKey: user.stellar_public_key,
    balance,
    referralCode: user.referral_code,
  });
});

// GET /api/wallet/transactions
router.get('/transactions', auth, async (req, res) => {
  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  const txs = await getTransactions(user.stellar_public_key);
  res.json({ success: true, data: txs });
});

// POST /api/wallet/fund - testnet only
router.post('/fund', auth, async (req, res) => {
  if (!isTestnet) return err(res, 400, 'Only available on testnet', 'testnet_only');

  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  try {
    await fundTestnetAccount(user.stellar_public_key);
    const balance = await getBalance(user.stellar_public_key);
    res.json({ success: true, message: 'Account funded with 10,000 XLM (testnet)', balance });
  } catch (e) {
    err(res, 500, e.message, 'fund_failed');
  }
});

// POST /api/wallet/send - send XLM to an external Stellar address
router.post('/send', auth, validate.sendXLM, async (req, res) => {
  const { destination, memo } = req.body;
  const amount = parseFloat(req.body.amount);

  const user = db
    .prepare('SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = ?')
    .get(req.user.id);

  if (destination === user.stellar_public_key)
    return res.status(400).json({ error: 'Cannot send XLM to your own wallet' });

  const balance = await getBalance(user.stellar_public_key);
  const required = amount + 0.00001;
  if (balance < required)
    return res.status(402).json({
      error: 'Insufficient XLM balance',
      required: required.toFixed(7),
      available: balance.toFixed(7),
    });

  try {
    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: memo || '',
    });

    res.json({ txHash, amount, destination, memo: memo || null });
  } catch (stellarErr) {
    const stellarMsg =
      stellarErr?.response?.data?.extras?.result_codes?.operations?.[0] || stellarErr.message;
    res.status(502).json({ error: `Stellar transaction failed: ${stellarMsg}` });
  }
});

module.exports = router;
