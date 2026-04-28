const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');

const MAX_IMPORT = 100;
const CACHE_TTL = 5 * 60 * 1000; // 5 min — same as rates.js
let rateCache = { rate: null, fetchedAt: 0 };

/**
 * Fetch XLM/USD rate with a 5-minute in-memory cache.
 * Falls back to stale cache rather than failing the import.
 */
async function getXlmRate() {
  const now = Date.now();
  if (rateCache.rate && now - rateCache.fetchedAt < CACHE_TTL) return rateCache.rate;

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error('CoinGecko request failed');
    const data = await res.json();
    const rate = data?.stellar?.usd;
    if (!rate) throw new Error('Rate not found in response');
    rateCache = { rate, fetchedAt: now };
    return rate;
  } catch {
    if (rateCache.rate) return rateCache.rate; // stale is fine for preview
    throw new Error('Unable to fetch XLM/USD exchange rate');
  }
}

/**
 * Validate and map one AgroAPI row to our internal product shape.
 * Returns { product } on success or { error } on failure.
 */
function mapRow(row, xlmRate) {
  const name = (row.name || '').trim();
  if (!name) return { error: 'name is required' };

  const priceUsd = parseFloat(row.price_usd);
  if (isNaN(priceUsd) || priceUsd <= 0) return { error: 'price_usd must be a positive number' };

  const quantity = parseInt(row.quantity, 10);
  if (isNaN(quantity) || quantity <= 0) return { error: 'quantity must be a positive integer' };

  const unit = (row.unit || 'unit').trim();
  const category = (row.category || 'other').trim();
  const description = (row.description || '').trim();

  // Convert USD → XLM (rate is USD per 1 XLM, so XLM = USD / rate)
  const priceXlm = parseFloat((priceUsd / xlmRate).toFixed(7));

  return {
    product: {
      name: sanitizeText(name),
      description: sanitizeText(description),
      price: priceXlm,
      price_usd: priceUsd,
      quantity,
      unit: sanitizeText(unit),
      category: sanitizeText(category),
    },
  };
}

/**
 * @swagger
 * /api/products/import:
 *   post:
 *     summary: Preview product import from JSON payload (farmer only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [products]
 *             properties:
 *               products:
 *                 type: array
 *                 maxItems: 100
 *                 items:
 *                   type: object
 *                   required: [name, price_usd, quantity]
 *                   properties:
 *                     name:        { type: string }
 *                     description: { type: string }
 *                     price_usd:   { type: number }
 *                     quantity:    { type: integer }
 *                     unit:        { type: string }
 *                     category:    { type: string }
 *     responses:
 *       200:
 *         description: Import preview — no data written yet
 */
// POST /api/products/import — returns a preview, nothing is saved
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can import products', 'forbidden');

  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return err(res, 400, 'products must be a non-empty array', 'validation_error');
  }
  if (products.length > MAX_IMPORT) {
    return err(res, 400, `Maximum ${MAX_IMPORT} products per import`, 'validation_error');
  }

  let xlmRate;
  try {
    xlmRate = await getXlmRate();
  } catch (e) {
    return err(res, 502, e.message, 'rate_fetch_error');
  }

  const valid = [];
  const errors = [];

  products.forEach((row, i) => {
    const result = mapRow(row, xlmRate);
    if (result.error) {
      errors.push({ row: i + 1, error: result.error });
    } else {
      valid.push(result.product);
    }
  });

  res.json({
    success: true,
    preview: valid,
    errors,
    xlmRate,
    total: products.length,
    valid: valid.length,
    skipped: errors.length,
  });
});

/**
 * @swagger
 * /api/products/import/confirm:
 *   post:
 *     summary: Confirm and persist a previously previewed import (farmer only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [products]
 *             properties:
 *               products:
 *                 type: array
 *                 maxItems: 100
 *                 items:
 *                   type: object
 *                   required: [name, price_usd, quantity]
 *                   properties:
 *                     name:        { type: string }
 *                     description: { type: string }
 *                     price_usd:   { type: number }
 *                     quantity:    { type: integer }
 *                     unit:        { type: string }
 *                     category:    { type: string }
 *     responses:
 *       200:
 *         description: Products created
 */
// POST /api/products/import/confirm — validates again and inserts
router.post('/confirm', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can import products', 'forbidden');

  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return err(res, 400, 'products must be a non-empty array', 'validation_error');
  }
  if (products.length > MAX_IMPORT) {
    return err(res, 400, `Maximum ${MAX_IMPORT} products per import`, 'validation_error');
  }

  let xlmRate;
  try {
    xlmRate = await getXlmRate();
  } catch (e) {
    return err(res, 502, e.message, 'rate_fetch_error');
  }

  const toInsert = [];
  const errors = [];

  products.forEach((row, i) => {
    const result = mapRow(row, xlmRate);
    if (result.error) {
      errors.push({ row: i + 1, error: result.error });
    } else {
      toInsert.push(result.product);
    }
  });

  if (toInsert.length === 0) {
    return err(res, 400, 'No valid products to import', 'validation_error');
  }

  // Insert all valid rows
  let created = 0;
  for (const p of toInsert) {
    await db.query(
      `INSERT INTO products (farmer_id, name, description, category, price, quantity, unit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.id, p.name, p.description, p.category, p.price, p.quantity, p.unit]
    );
    created++;
  }

  res.json({
    success: true,
    created,
    skipped: errors.length,
    errors,
    xlmRate,
  });
});

module.exports = router;
