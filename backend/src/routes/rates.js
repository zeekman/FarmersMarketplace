const router = require('express').Router();
const { err } = require('../middleware/error');

let cache = { rate: null, fetchedAt: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// GET /api/rates/xlm-usd
router.get('/xlm-usd', async (req, res) => {
  const now = Date.now();

  if (cache.rate && now - cache.fetchedAt < CACHE_TTL) {
    return res.json({ success: true, rate: cache.rate, cached: true });
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) throw new Error('CoinGecko request failed');
    const data = await response.json();
    const rate = data?.stellar?.usd;
    if (!rate) throw new Error('Rate not found in response');

    cache = { rate, fetchedAt: now };
    res.json({ success: true, rate, cached: false });
  } catch {
    // Return stale cache if available rather than failing
    if (cache.rate) return res.json({ success: true, rate: cache.rate, cached: true, stale: true });
    err(res, 502, 'Unable to fetch exchange rate', 'rate_fetch_error');
  }
});

module.exports = router;
