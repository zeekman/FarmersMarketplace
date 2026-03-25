const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { getBalance, getTransactions, fundTestnetAccount, isTestnet } = require('../utils/stellar');
const { err } = require('../middleware/error');

// GET /api/wallet
router.get('/', auth, async (req, res) => {
  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  const balance = await getBalance(user.stellar_public_key);
  res.json({ success: true, publicKey: user.stellar_public_key, balance });
});

// GET /api/wallet/transactions
router.get('/transactions', auth, async (req, res) => {
  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  const txs = await getTransactions(user.stellar_public_key);
  res.json({ success: true, data: txs });
});

// POST /api/wallet/fund - testnet only
router.post('/fund', auth, async (req, res) => {
  if (!isTestnet)
    return err(res, 400, 'Only available on testnet', 'testnet_only');

  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  try {
    await fundTestnetAccount(user.stellar_public_key);
    const balance = await getBalance(user.stellar_public_key);
    res.json({ success: true, message: 'Account funded with 10,000 XLM (testnet)', balance });
  } catch (e) {
    err(res, 500, e.message, 'fund_failed');
  }
});

module.exports = router;
