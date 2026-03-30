const router = require('express').Router();
const db = require('../db/schema');
const { err } = require('../middleware/error');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

function buildShareUrl(productId) {
  return `${FRONTEND_URL}/product/${productId}`;
}

router.get('/:id/share', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return err(res, 400, 'Invalid product id', 'validation_error');

  const { rows } = await db.query(
    `SELECT p.id, p.name, p.description, p.image_url, u.name AS farmer_name
     FROM products p
     JOIN users u ON u.id = p.farmer_id
     WHERE p.id = $1`,
    [id]
  );

  const product = rows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  const url = buildShareUrl(product.id);
  const title = `${product.name} on Farmers Marketplace`;
  const description = product.description || `Fresh produce from ${product.farmer_name}`;

  res.json({
    success: true,
    data: {
      productId: product.id,
      title,
      description,
      image: product.image_url || null,
      url,
    },
  });
});

router.post('/:id/share', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return err(res, 400, 'Invalid product id', 'validation_error');

  const platform = String(req.body.platform || '')
    .trim()
    .toLowerCase();
  const allowed = new Set(['whatsapp', 'twitter', 'facebook', 'copy_link']);
  if (!allowed.has(platform)) {
    return err(res, 400, 'Invalid platform', 'validation_error');
  }

  const userId = req.user?.id || null;
  const userAgent = req.headers['user-agent'] || null;

  await db.query(
    `INSERT INTO share_events (product_id, user_id, platform, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, platform, userAgent]
  );

  res.status(201).json({ success: true });
});

module.exports = router;
