const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { sendPayment, getBalance } = require('../utils/stellar');

// GET /api/bundles — public listing
router.get('/', (req, res) => {
  const bundles = db
    .prepare(
      `
    SELECT b.*, u.name as farmer_name FROM bundles b
    JOIN users u ON b.farmer_id = u.id
    ORDER BY b.created_at DESC
  `
    )
    .all();

  const items = db.prepare(`
    SELECT bi.*, p.name as product_name, p.unit, p.quantity as stock
    FROM bundle_items bi JOIN products p ON bi.product_id = p.id
    WHERE bi.bundle_id = ?
  `);

  const data = bundles.map((b) => ({ ...b, items: items.all(b.id) }));
  res.json({ success: true, data });
});

// POST /api/bundles — farmer creates a bundle
router.post('/', auth, (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can create bundles', 'forbidden');

  const { name, description, price, items } = req.body;
  if (!name || !name.trim()) return err(res, 400, 'name is required', 'validation_error');
  const bundlePrice = parseFloat(price);
  if (isNaN(bundlePrice) || bundlePrice <= 0)
    return err(res, 400, 'price must be a positive number', 'validation_error');
  if (!Array.isArray(items) || items.length === 0)
    return err(res, 400, 'items must be a non-empty array', 'validation_error');

  const invalidProductIds = [];
  for (const item of items) {
    if (!item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1) {
      return err(
        res,
        400,
        'Each item needs product_id and a positive integer quantity',
        'validation_error'
      );
    }
    const product = db
      .prepare('SELECT id, farmer_id FROM products WHERE id = ?')
      .get(item.product_id);
    if (!product || product.farmer_id !== req.user.id) {
      invalidProductIds.push(item.product_id);
    }
  }
  if (invalidProductIds.length > 0) {
    return err(res, 400, `Invalid product IDs: ${invalidProductIds.join(', ')}`, 'validation_error');
  }

  const create = db.transaction(() => {
    const bundle = db
      .prepare('INSERT INTO bundles (farmer_id, name, description, price) VALUES (?, ?, ?, ?)')
      .run(req.user.id, name.trim(), description || null, bundlePrice);

    const insertItem = db.prepare(
      'INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?, ?, ?)'
    );
    for (const item of items)
      insertItem.run(bundle.lastInsertRowid, item.product_id, item.quantity);
    return bundle.lastInsertRowid;
  });

  const id = create();
  res.status(201).json({ success: true, id });
});

// DELETE /api/bundles/:id — farmer removes own bundle
router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const bundle = db
    .prepare('SELECT * FROM bundles WHERE id = ? AND farmer_id = ?')
    .get(req.params.id, req.user.id);
  if (!bundle) return err(res, 404, 'Bundle not found or not yours', 'not_found');
  db.prepare('DELETE FROM bundles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/orders/bundle — buyer purchases a bundle
router.post('/purchase', auth, async (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can purchase bundles', 'forbidden');

  const { bundle_id } = req.body;
  if (!bundle_id) return err(res, 400, 'bundle_id is required', 'validation_error');

  const bundle = db
    .prepare(
      `
    SELECT b.*, u.stellar_public_key as farmer_wallet
    FROM bundles b JOIN users u ON b.farmer_id = u.id
    WHERE b.id = ?
  `
    )
    .get(bundle_id);
  if (!bundle) return err(res, 404, 'Bundle not found', 'not_found');

  const items = db
    .prepare(
      `
    SELECT bi.*, p.quantity as stock, p.name as product_name
    FROM bundle_items bi JOIN products p ON bi.product_id = p.id
    WHERE bi.bundle_id = ?
  `
    )
    .all(bundle_id);

  // Check stock for all items
  for (const item of items) {
    if (item.stock < item.quantity)
      return err(res, 400, `Insufficient stock for "${item.product_name}"`, 'insufficient_stock');
  }

  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const balance = await getBalance(buyer.stellar_public_key);
  if (balance < bundle.price + 0.00001)
    return res
      .status(402)
      .json({ success: false, message: 'Insufficient XLM balance', code: 'insufficient_balance' });

  // Atomically decrement stock for all items and create bundle_order record
  const reserve = db.transaction(() => {
    for (const item of items) {
      const result = db
        .prepare('UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?')
        .run(item.quantity, item.product_id, item.quantity);
      if (result.changes === 0) throw new Error(`Insufficient stock for "${item.product_name}"`);
    }
    const order = db
      .prepare(
        'INSERT INTO bundle_orders (buyer_id, bundle_id, total_price, status) VALUES (?, ?, ?, ?)'
      )
      .run(req.user.id, bundle_id, bundle.price, 'pending');
    return order.lastInsertRowid;
  });

  let orderId;
  try {
    orderId = reserve();
  } catch (e) {
    return err(res, 400, e.message, 'insufficient_stock');
  }

  try {
    const txHash = await sendPayment({
      senderSecret: buyer.stellar_secret_key,
      receiverPublicKey: bundle.farmer_wallet,
      amount: bundle.price,
      memo: `Bundle#${orderId}`,
    });

    db.prepare('UPDATE bundle_orders SET status = ?, stellar_tx_hash = ? WHERE id = ?').run(
      'paid',
      txHash,
      orderId
    );

    res.json({ success: true, orderId, txHash, totalPrice: bundle.price });
  } catch (e) {
    db.transaction(() => {
      db.prepare('UPDATE bundle_orders SET status = ? WHERE id = ?').run('failed', orderId);
      for (const item of items)
        db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(
          item.quantity,
          item.product_id
        );
    })();
    res
      .status(402)
      .json({
        success: false,
        message: 'Payment failed: ' + e.message,
        code: 'payment_failed',
        orderId,
      });
  }
});

// GET /api/bundles/orders — buyer's bundle order history
router.get('/orders', auth, (req, res) => {
  const data = db
    .prepare(
      `
    SELECT bo.*, b.name as bundle_name, b.description as bundle_description
    FROM bundle_orders bo JOIN bundles b ON bo.bundle_id = b.id
    WHERE bo.buyer_id = ?
    ORDER BY bo.created_at DESC
  `
    )
    .all(req.user.id);
  res.json({ success: true, data });
});

module.exports = router;
