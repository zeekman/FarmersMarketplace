const router = require('express').Router();
const QRCode = require('qrcode');
const db = require('../db/schema');
const { err } = require('../middleware/error');
const { getOrderBook } = require('../utils/stellar');

// In-memory cache for order book data
let _cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 60 * 1000; // 60 seconds

// GET /api/market/xlm-usdc — returns XLM/USDC order book with 60s cache
router.get('/xlm-usdc', async (req, res) => {
  const now = Date.now();

  if (_cache.data && now - _cache.fetchedAt < CACHE_TTL) {
    return res.json({ ..._cache.data, cached: true });
  }

  try {
    const data = await getOrderBook();
    _cache = { data, fetchedAt: now };
    return res.json({ ...data, cached: false });
  } catch (e) {
    if (_cache.data) {
      return res.json({ ..._cache.data, cached: true, stale: true });
    }
    return err(res, 503, 'Stellar DEX data unavailable', 'dex_unavailable');
  }
});

// GET /api/products/:id/qr — returns a PNG QR code for the product URL
router.get('/:id/qr', async (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const frontendUrl = (
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_ORIGIN ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
  const productUrl = `${frontendUrl}/product/${product.id}`;

  try {
    const png = await QRCode.toBuffer(productUrl, {
      type: 'png',
      width: 300,
      margin: 2,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="product-${product.id}-qr.png"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (e) {
    return err(res, 500, 'Failed to generate QR code', 'qr_error');
  }
});

module.exports = router;
