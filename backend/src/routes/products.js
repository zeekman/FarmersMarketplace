const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const { sendBackInStockEmail } = require('../utils/mailer');

router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { category, minPrice, maxPrice, seller, available = 'true' } = req.query;
  const conditions = [];
  const params = [];

  if (available === 'true') conditions.push('p.quantity > 0');
  if (category) {
    conditions.push('p.category = $1');
    params.push(category);
  }
  if (minPrice !== undefined) {
    const min = parseFloat(minPrice);
    if (!Number.isNaN(min)) {
      conditions.push('p.price >= $1');
      params.push(min);
    }
  }
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!Number.isNaN(max)) {
      conditions.push('p.price <= $1');
      params.push(max);
    }
  }
  if (seller) {
    conditions.push('u.name ILIKE $1');
    params.push(`%${seller}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRes = await db.query(`SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`, params);
  const total = parseInt(countRes.rows[0]?.count || '0', 10);

  const { rows } = await db.query(
    `SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar,
            ROUND(AVG(r.rating), 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     ${where}
     GROUP BY p.id, u.id, u.name, u.bio, u.location, u.avatar_url
     ORDER BY p.created_at DESC
     LIMIT $1 OFFSET $2`,
    [...params, limit, offset]
  );

  res.json({ success: true, data: rows, total, page, limit, totalPages: Math.ceil(total / limit) || 0 });
});

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    const { rows } = await db.query(
      `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC LIMIT 100`
    );
    return res.json({ success: true, data: rows });
  }

  const like = `%${q}%`;
  const { rows } = await db.query(
    `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id
     WHERE p.name ILIKE $1 OR p.description ILIKE $2 ORDER BY p.created_at DESC LIMIT 100`,
    [like, like]
  );
  res.json({ success: true, data: rows });
});

router.get('/categories', async (_req, res) => {
  const { rows } = await db.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');
  res.json({ success: true, data: rows.map((r) => r.category) });
});

router.get('/mine/list', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { rows } = await db.query('SELECT * FROM products WHERE farmer_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ success: true, data: rows });
});

router.post('/', auth, validate.product, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can create products', 'forbidden');

  const body = { ...req.body };
  if (typeof body.name === 'string') body.name = sanitizeText(body.name);
  if (typeof body.description === 'string') body.description = sanitizeText(body.description);

  const { rows } = await db.query(
    `INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [req.user.id, body.name, body.description || null, body.category || 'other', Number(body.price), Number(body.quantity), body.unit || 'unit', body.image_url || null]
  );

  res.json({ success: true, id: rows[0].id });
});

router.post('/upload-image', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can upload images', 'forbidden');

  upload.single('image')(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') return err(res, 400, 'Image must be 5 MB or smaller', 'file_too_large');
      if (uploadErr.code === 'INVALID_TYPE') return err(res, 400, uploadErr.message, 'invalid_file_type');
      return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.file) return err(res, 400, 'No image file provided', 'no_file');
    res.json({ success: true, imageUrl: `/uploads/${req.file.filename}` });
  });
});

router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar, u.stellar_public_key as farmer_wallet,
            ROUND(AVG(r.rating), 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     WHERE p.id = $1
     GROUP BY p.id, u.id, u.name, u.bio, u.location, u.avatar_url, u.stellar_public_key`,
    [req.params.id]
  );

  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  res.json({ success: true, data: rows[0] });
});

router.patch('/:id/restock', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can restock products', 'forbidden');

  const quantity = parseInt(req.body.quantity, 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    return err(res, 400, 'Quantity must be a positive integer', 'validation_error');
  }

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  const product = rows[0];
  if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

  const wasOutOfStock = product.quantity === 0;
  await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [quantity, req.params.id]);

  if (wasOutOfStock) {
    const { rows: subscribers } = await db.query(
      `SELECT u.email, u.name FROM stock_alerts sa JOIN users u ON sa.user_id = u.id WHERE sa.product_id = $1`,
      [req.params.id]
    );

    if (subscribers.length > 0) {
      await db.query('DELETE FROM stock_alerts WHERE product_id = $1', [req.params.id]);
      await Promise.all(
        subscribers.map((s) => sendBackInStockEmail({ email: s.email, name: s.name, productName: product.name }))
      ).catch((e) => console.error('[stock-alert] Email send failed:', e.message));
    }
  }

  res.json({ success: true, message: 'Restocked successfully' });
});

router.post('/:id/alert', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can set stock alerts', 'forbidden');

  const { rows: existing } = await db.query(
    'SELECT id FROM stock_alerts WHERE user_id = $1 AND product_id = $2',
    [req.user.id, req.params.id]
  );

  if (existing.length === 0) {
    await db.query('INSERT INTO stock_alerts (user_id, product_id) VALUES ($1, $2)', [req.user.id, req.params.id]);
  }

  res.json({ success: true, subscribed: true });
});

router.delete('/:id/alert', auth, async (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can remove stock alerts', 'forbidden');
  await db.query('DELETE FROM stock_alerts WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.id]);
  res.json({ success: true, subscribed: false });
});

router.get('/:id/alert/status', auth, async (req, res) => {
  const { rows } = await db.query('SELECT id FROM stock_alerts WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.id]);
  res.json({ success: true, subscribed: rows.length > 0 });
});

router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can delete products', 'forbidden');

  const { rows } = await db.query('SELECT farmer_id FROM products WHERE id = $1', [req.params.id]);
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  if (rows[0].farmer_id !== req.user.id) return err(res, 404, 'Product not found', 'not_found');

  await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true, deleted: true });
});

module.exports = router;
