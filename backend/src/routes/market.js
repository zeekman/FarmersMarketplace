const router = require('express').Router();
const QRCode = require('qrcode');
const db = require('../db/schema');
const { err } = require('../middleware/error');

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
