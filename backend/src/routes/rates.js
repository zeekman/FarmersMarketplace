/**
 * GET /api/rates?currency=USD,KES,EUR
 *
 * Returns XLM exchange rates with:
 *  - 60-second in-memory cache (stale-while-revalidate)
 *  - Primary → fallback provider chain
 *  - `stale` flag so the frontend can warn the user
 */

const router = require('express').Router();

const CACHE_TTL_MS = 60_000;
const PRIMARY_URL  = process.env.RATE_PROVIDER_URL         || 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=';
const FALLBACK_URL = process.env.RATE_PROVIDER_FALLBACK_URL || 'https://api.coinpaprika.com/v1/tickers/xlm-stellar?quotes=';

let cache = { rates: null, fetched_at: null, expiresAt: 0 };
let refreshInFlight = false;

// Normalise CoinGecko response: { stellar: { usd: 0.1, kes: 15 } }
function parseCoinGecko(data, currencies) {
  const src = data?.stellar || {};
  return Object.fromEntries(currencies.map(c => [c.toUpperCase(), src[c.toLowerCase()] ?? null]));
}

// Normalise CoinPaprika response: { quotes: { USD: { price: 0.1 } } }
function parseCoinPaprika(data, currencies) {
  const quotes = data?.quotes || {};
  return Object.fromEntries(currencies.map(c => [c.toUpperCase(), quotes[c.toUpperCase()]?.price ?? null]));
}

async function fetchRates(currencies) {
  const joined = currencies.join(',').toLowerCase();

  // Try primary (CoinGecko)
  try {
    const res = await fetch(`${PRIMARY_URL}${joined}`);
    if (res.ok) return parseCoinGecko(await res.json(), currencies);
  } catch { /* fall through */ }

  // Try fallback (CoinPaprika — one call per currency or joined if supported)
  const rates = {};
  for (const c of currencies) {
    try {
      const res = await fetch(`${FALLBACK_URL}${c.toUpperCase()}`);
      if (res.ok) {
        const data = await res.json();
        rates[c.toUpperCase()] = parseCoinPaprika(data, [c])[c.toUpperCase()];
      } else {
        rates[c.toUpperCase()] = null;
      }
    } catch {
      rates[c.toUpperCase()] = null;
    }
  }
  return rates;
}

async function refreshCache(currencies) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const rates = await fetchRates(currencies);
    cache = { rates, fetched_at: new Date().toISOString(), expiresAt: Date.now() + CACHE_TTL_MS };
  } catch (err) {
    console.error('[rates] refresh failed:', err.message);
  } finally {
    refreshInFlight = false;
  }
}

router.get('/', async (req, res) => {
  const currencies = (req.query.currency || 'USD')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);

  const now = Date.now();
  const stale = cache.rates !== null && now > cache.expiresAt;

  if (cache.rates === null) {
    // Cold start — must wait for first fetch.
    await refreshCache(currencies);
    if (!cache.rates) return res.status(502).json({ error: 'Rate providers unavailable' });
  } else if (stale) {
    // Serve stale immediately; refresh in background.
    refreshCache(currencies);
  }

  // Filter cached rates to only the requested currencies.
  const rates = Object.fromEntries(
    currencies.map(c => [c, cache.rates[c] ?? null])
  );

  res.json({ rates, fetched_at: cache.fetched_at, stale });
});

module.exports = router;
