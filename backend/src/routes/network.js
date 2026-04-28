const router = require('express').Router();
const { isTestnet } = require('../utils/stellar');

router.get('/network', (req, res) => {
  res.json({ network: isTestnet ? 'testnet' : 'mainnet' });
});

module.exports = router;
