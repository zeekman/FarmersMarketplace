/**
 * Fixed-path /products endpoints the SPA calls (#1368).
 *
 * This router is mounted at /products *before* routes/products.js, because
 * that router's `GET /:id` and `PATCH /:id` would otherwise swallow
 * /products/categories, /products/search and /products/bulk-price.
 */

const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const cache = require('../cache');
const upload = require('../middleware/upload');
const { verifyUploadedFile } = require('../middleware/upload');
const { err } = require('../middleware/error');
const { rewriteImageUrl } = require('../utils/cdn');
const categoriesRouter = require('./categories');

const SEARCH_LIMIT = 20;

// GET /api/products/categories — same payload as GET /api/categories
router.get('/categories', (req, res, next) => {
  req.url = '/';
  categoriesRouter(req, res, next);
});

// GET /api/products/search?q= — quick name/description search for pickers
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const like = db.isPostgres ? 'ILIKE' : 'LIKE';
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.price, p.unit, p.quantity, p.image_url, u.name AS farmer_name
     FROM products p JOIN users u ON p.farmer_id = u.id
     WHERE p.name ${like} $1 OR p.description ${like} $2
     ORDER BY p.name ASC
     LIMIT $3`,
    [`%${q}%`, `%${q}%`, SEARCH_LIMIT]
  );
  res.json({
    success: true,
    data: rows.map((p) => ({ ...p, image_url: rewriteImageUrl(p.image_url) })),
  });
});

// POST /api/products/upload-image — single image upload (multipart field "image")
// Returns { imageUrl } for the caller to store on a product or profile.
router.post('/upload-image', auth, (req, res) => {
  upload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE')
        return err(res, 400, 'Image must be 5 MB or smaller', 'file_too_large');
      if (uploadErr.code === 'INVALID_TYPE')
        return err(res, 400, uploadErr.message, 'invalid_file_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.file) return err(res, 400, 'No image file provided', 'no_file');

    try {
      // Validate file content with magic-byte detection
      const verified = await verifyUploadedFile(req.file);
      res.status(201).json({
        success: true,
        imageUrl: rewriteImageUrl(verified.url || `/uploads/${verified.filename}`),
      });
    } catch (verifyErr) {
      if (verifyErr.code === 'INVALID_TYPE') {
        return err(res, 415, verifyErr.message, 'unsupported_media_type');
      }
      return err(res, 400, 'File validation failed', 'validation_error');
    }
  });
});

// PATCH /api/products/bulk-price — farmer updates several of their prices at once
// Body: { updates?: [{ product_id, price }], adjustment_percent?: number }
// Explicit updates win; adjustment_percent applies to the farmer's other products.
router.patch('/bulk-price', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can update prices', 'forbidden');

  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  const pct = req.body?.adjustment_percent;
  const hasPct = pct !== undefined && pct !== null && pct !== '';

  if (updates.length === 0 && !hasPct) {
    return err(res, 400, 'Provide updates or adjustment_percent', 'validation_error');
  }
  for (const u of updates) {
    if (!Number.isInteger(Number(u?.product_id)) || !(Number(u?.price) > 0)) {
      return err(
        res,
        400,
        'Each update needs a product_id and a positive price',
        'validation_error'
      );
    }
  }
  if (hasPct && (!Number.isFinite(Number(pct)) || Number(pct) <= -100)) {
    return err(
      res,
      400,
      'adjustment_percent must be a number greater than -100',
      'validation_error'
    );
  }

  const { rows: owned } = await db.query('SELECT id, price FROM products WHERE farmer_id = $1', [
    req.user.id,
  ]);
  const ownedById = new Map(owned.map((p) => [Number(p.id), p]));

  const newPrices = new Map();
  for (const u of updates) {
    const id = Number(u.product_id);
    if (!ownedById.has(id))
      return err(res, 404, `Product ${id} not found or not yours`, 'not_found');
    newPrices.set(id, Number(u.price));
  }
  if (hasPct) {
    const factor = 1 + Number(pct) / 100;
    for (const p of owned) {
      const id = Number(p.id);
      if (!newPrices.has(id)) newPrices.set(id, Math.round(Number(p.price) * factor * 1e7) / 1e7);
    }
  }

  let updated = 0;
  for (const [id, price] of newPrices) {
    if (!(price > 0) || price === Number(ownedById.get(id).price)) continue;
    await db.query('UPDATE products SET price = $1 WHERE id = $2 AND farmer_id = $3', [
      price,
      id,
      req.user.id,
    ]);
    await db.query('INSERT INTO price_history (product_id, price) VALUES ($1, $2)', [id, price]);
    updated++;
  }

  if (updated > 0) await cache.delByPattern('products:*');
  res.json({ success: true, data: { updated } });
});

module.exports = router;
