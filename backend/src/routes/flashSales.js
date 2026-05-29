const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

router.patch('/:id/flash-sale', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can manage flash sales', 'forbidden');

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return err(res, 400, 'Invalid product id', 'validation_error');

  const flashSalePrice =
    req.body.flash_sale_price == null ? null : Number(req.body.flash_sale_price);
  const flashSaleEndsAt = req.body.flash_sale_ends_at
    ? new Date(req.body.flash_sale_ends_at)
    : null;

  const { rows } = await db.query('SELECT id, farmer_id, price, flash_sale_ends_at FROM products WHERE id = $1', [id]);
  const product = rows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');
  if (product.farmer_id !== req.user.id) return err(res, 403, 'Not your product', 'forbidden');

  if (flashSalePrice != null) {
    // Check for overlapping flash sales
    if (product.flash_sale_ends_at && new Date(product.flash_sale_ends_at) > new Date()) {
      return err(res, 409, 'Cannot create overlapping flash sales on the same product', 'flash_sale_overlap');
    }
    if (!Number.isFinite(flashSalePrice) || flashSalePrice <= 0) {
      return err(res, 400, 'flash_sale_price must be a positive number', 'validation_error');
    }
    if (flashSalePrice >= Number(product.price)) {
      return err(res, 400, 'Flash sale price must be less than regular price', 'validation_error');
    }
    if (!flashSaleEndsAt || Number.isNaN(flashSaleEndsAt.getTime())) {
      return err(
        res,
        400,
        'flash_sale_ends_at is required when setting flash sale',
        'validation_error'
      );
    }
  }

  await db.query(
    'UPDATE products SET flash_sale_price = $1, flash_sale_ends_at = $2 WHERE id = $3',
    [flashSalePrice, flashSaleEndsAt ? flashSaleEndsAt.toISOString() : null, id]
  );

  const { rows: updatedRows } = await db.query(
    'SELECT id, price, flash_sale_price, flash_sale_ends_at FROM products WHERE id = $1',
    [id]
  );
  res.json({ success: true, data: updatedRows[0] });
});

router.delete('/:id/flash-sale', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can manage flash sales', 'forbidden');

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return err(res, 400, 'Invalid product id', 'validation_error');

  const { rows } = await db.query('SELECT id, farmer_id FROM products WHERE id = $1', [id]);
  const product = rows[0];
  if (!product) return err(res, 404, 'Product not found', 'not_found');
  if (product.farmer_id !== req.user.id) return err(res, 403, 'Not your product', 'forbidden');

  await db.query(
    'UPDATE products SET flash_sale_price = NULL, flash_sale_ends_at = NULL WHERE id = $1',
    [id]
  );
  res.json({ success: true });
});

module.exports = router;
