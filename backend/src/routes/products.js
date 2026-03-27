const path = require("path");
const router = require("express").Router();
const db = require("../db/schema");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const upload = require("../middleware/upload");
const { err } = require("../middleware/error");
const { sanitizeText } = require("../utils/sanitize");
const path = require('path');
const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');
const { sendBackInStockEmail } = require('../utils/mailer');

// GET /api/products - public browse with optional filters
router.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const {
    category,
    minPrice,
    maxPrice,
    seller,
    available = "true",
  } = req.query;

  const conditions = [];
  const countParams = [];
  const dataParams = [];

  if (available === "true") conditions.push("p.quantity > 0");

  if (category) {
    conditions.push("p.category = ?");
    countParams.push(category);
    dataParams.push(category);
  }
  if (minPrice !== undefined) {
    const min = parseFloat(minPrice);
    if (!isNaN(min)) {
      conditions.push("p.price >= ?");
      countParams.push(min);
      dataParams.push(min);
    }
  }
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!isNaN(max)) {
      conditions.push("p.price <= ?");
      countParams.push(max);
      dataParams.push(max);
    }
  }
  if (seller) {
    conditions.push("u.name LIKE ?");
    countParams.push(`%${seller}%`);
    dataParams.push(`%${seller}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`,
    )
    .get(...countParams).count;

  const products = db
    .prepare(
      `SELECT p.*, u.name as farmer_name,
            ROUND(AVG(r.rating), 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...dataParams, limit, offset);

  res.json({
    success: true,
    data: products,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// GET /api/products/search?q=tomato - FTS5 full-text search
router.get("/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    // Empty query returns all products
    const products = db
      .prepare(
        `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC LIMIT 100`,
      )
      .all();
    return res.json({ success: true, data: products });
  }
  try {
    const products = db
      .prepare(
        `
      SELECT p.*, u.name as farmer_name, fts.rank
      FROM products_fts fts
      JOIN products p ON p.id = fts.rowid
      JOIN users u ON p.farmer_id = u.id
      WHERE products_fts MATCH ?
      ORDER BY fts.rank
      LIMIT 100
    `,
      )
      .all(q);
    res.json({ success: true, data: products });
  } catch {
    // Fallback to LIKE search if FTS fails (e.g. special chars)
    const like = `%${q}%`;
    const products = db
      .prepare(
        `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id
       WHERE p.name LIKE ? OR p.description LIKE ? ORDER BY p.created_at DESC LIMIT 100`,
      )
      .all(like, like);
    res.json({ success: true, data: products });
  }
});

// GET /api/products/categories
router.get("/categories", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category`,
    )
    .all();
  res.json({ success: true, data: rows.map((r) => r.category) });
});

// GET /api/products/mine/list - farmer's own products (must be before /:id)
router.get("/mine/list", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Farmers only", "forbidden");
  res.json({
    success: true,
    data: db
      .prepare(
        "SELECT * FROM products WHERE farmer_id = ? ORDER BY created_at DESC",
      )
      .all(req.user.id),
  });
});

// POST /api/products/upload-image - upload a product image (farmer only, before listing)
router.post("/upload-image", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can upload images", "forbidden");

  upload.single("image")(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === "LIMIT_FILE_SIZE")
        return err(res, 400, "Image must be 5 MB or smaller", "file_too_large");
      if (uploadErr.code === "INVALID_TYPE")
        return err(res, 400, uploadErr.message, "invalid_file_type");
      return err(res, 400, "Upload failed", "upload_error");
    }
    if (!req.file) return err(res, 400, "No image file provided", "no_file");

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl });
  });
});

// GET /api/products/:id
router.get("/:id", (req, res) => {
  const product = db
    .prepare(
      `
    SELECT p.*, u.name as farmer_name, u.stellar_public_key as farmer_wallet,
           ROUND(AVG(r.rating), 1) as avg_rating,
           COUNT(r.id) as review_count
    FROM products p
    JOIN users u ON p.farmer_id = u.id
    LEFT JOIN reviews r ON r.product_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `,
    )
    .get(req.params.id);
  if (!product) return err(res, 404, "Product not found", "not_found");
  res.json({ success: true, data: product });
});

// PATCH /api/products/:id/restock - farmer only
router.patch("/:id/restock", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can restock products", "forbidden");

  const quantity = parseInt(req.body.quantity, 10);
  if (isNaN(quantity) || quantity <= 0)
    return err(
      res,
      400,
      "Quantity must be a positive integer",
      "validation_error",
    );

  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND farmer_id = ?")
    .get(req.params.id, req.user.id);
  if (!product)
    return err(res, 404, "Product not found or not yours", "not_found");

  db.prepare("UPDATE products SET quantity = quantity + ? WHERE id = ?").run(
    quantity,
    req.params.id,
  );
  res.json({ success: true, message: "Restocked successfully" });
router.patch('/:id/restock', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can restock products', 'forbidden');

  const quantity = parseInt(req.body.quantity, 10);
  if (isNaN(quantity) || quantity <= 0) return err(res, 400, 'Quantity must be a positive integer', 'validation_error');

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(req.params.id, req.user.id);
  if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

  const wasOutOfStock = product.quantity === 0;
  db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, req.params.id);

  // Notify subscribers if product was out of stock
  if (wasOutOfStock) {
    const subscribers = db.prepare(`
      SELECT u.email, u.name FROM stock_alerts sa
      JOIN users u ON sa.user_id = u.id
      WHERE sa.product_id = ?
    `).all(req.params.id);

    if (subscribers.length > 0) {
      db.prepare('DELETE FROM stock_alerts WHERE product_id = ?').run(req.params.id);
      Promise.all(
        subscribers.map(s => sendBackInStockEmail({ email: s.email, name: s.name, productName: product.name }))
      ).catch(e => console.error('[stock-alert] Email send failed:', e.message));
    }
  }

  res.json({ success: true, message: 'Restocked successfully' });
});

// POST /api/products/:id/alert - buyer subscribes to back-in-stock notification
router.post('/:id/alert', auth, (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can set alerts', 'forbidden');

  const product = db.prepare('SELECT id, quantity FROM products WHERE id = ?').get(req.params.id);
  if (!product) return err(res, 404, 'Product not found', 'not_found');
  if (product.quantity > 0) return err(res, 400, 'Product is already in stock', 'in_stock');

  try {
    db.prepare('INSERT INTO stock_alerts (user_id, product_id) VALUES (?, ?)').run(req.user.id, req.params.id);
    res.json({ success: true, message: 'Alert set' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return err(res, 409, 'Alert already set', 'conflict');
    throw e;
  }
});

// DELETE /api/products/:id/alert - buyer unsubscribes
router.delete('/:id/alert', auth, (req, res) => {
  db.prepare('DELETE FROM stock_alerts WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.id);
  res.json({ success: true, message: 'Alert removed' });
});

// GET /api/products/:id/alert/status - check if current user has an alert set
router.get('/:id/alert/status', auth, (req, res) => {
  const row = db.prepare('SELECT id FROM stock_alerts WHERE user_id = ? AND product_id = ?').get(req.user.id, req.params.id);
  res.json({ success: true, subscribed: !!row });
});

// POST /api/products - farmer only
router.post("/", auth, validate.product, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can list products", "forbidden");

  const { name, description, unit, category, image_url } = req.body;
  const price = parseFloat(req.body.price);
  const { name, description, unit, category, image_url, tags } = req.body;
  const price    = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name || !name.trim())
    return err(res, 400, "Product name is required", "validation_error");
  if (isNaN(price) || price <= 0)
    return err(res, 400, "Price must be a positive number", "validation_error");
  if (isNaN(quantity) || quantity < 1)
    return err(
      res,
      400,
      "Quantity must be a positive integer",
      "validation_error",
    );

  // Sanitize user-generated text before storing
  const safeName = sanitizeText(name);
  const safeDescription = sanitizeText(description || "");
  const safeUnit = sanitizeText(unit || "unit");
  const safeCategory = sanitizeText(category || "other");

  // Validate image_url if provided — must be a known upload path
  const safeImageUrl =
    image_url && /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(image_url)
      ? image_url
      : null;

  const result = db
    .prepare(
      "INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      req.user.id,
      safeName,
      safeDescription,
      safeCategory,
      price,
      quantity,
      safeUnit,
      safeImageUrl,
      parseInt(req.body.low_stock_threshold) || 5,
    );

  res.json({
    success: true,
    id: result.lastInsertRowid,
    message: "Product listed",
  });
});

// PATCH /api/products/:id - farmer updates own product
router.patch("/:id", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can edit products", "forbidden");

  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND farmer_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return err(res, 404, "Not found or not yours", "not_found");

  const allowed = [
    "name",
    "description",
    "price",
    "quantity",
    "unit",
    "category",
    "low_stock_threshold",
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0)
    return err(res, 400, "No valid fields to update", "validation_error");

  // Sanitize text fields
  if (updates.name !== undefined) updates.name = sanitizeText(updates.name);
  if (updates.description !== undefined)
    updates.description = sanitizeText(updates.description);
  if (updates.unit !== undefined) updates.unit = sanitizeText(updates.unit);
  if (updates.category !== undefined)
    updates.category = sanitizeText(updates.category);

  if (updates.price !== undefined) {
    updates.price = parseFloat(updates.price);
    if (isNaN(updates.price) || updates.price <= 0)
      return err(res, 400, "Price must be positive", "validation_error");
  }
  if (updates.quantity !== undefined) {
    updates.quantity = parseInt(updates.quantity, 10);
    if (isNaN(updates.quantity) || updates.quantity < 0)
      return err(res, 400, "Quantity must be non-negative", "validation_error");
  }
  if (updates.low_stock_threshold !== undefined) {
    updates.low_stock_threshold = parseInt(updates.low_stock_threshold, 10);
    if (isNaN(updates.low_stock_threshold) || updates.low_stock_threshold < 0)
      return err(
        res,
        400,
        "Threshold must be non-negative",
        "validation_error",
      );
  }

  // Reset low_stock_alerted if quantity is being raised above threshold
  const newQty = updates.quantity ?? product.quantity;
  const newThreshold =
    updates.low_stock_threshold ?? product.low_stock_threshold ?? 5;
  if (newQty > newThreshold) updates.low_stock_alerted = 0;

  const setClauses = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  db.prepare(`UPDATE products SET ${setClauses} WHERE id = ?`).run(
    ...Object.values(updates),
    req.params.id,
  );

  res.json({ success: true, message: "Product updated" });
});

// DELETE /api/products/:id
router.delete("/:id", auth, (req, res) => {
  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND farmer_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return err(res, 404, "Not found or not yours", "not_found");
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.json({ success: true, message: "Deleted" });
});

// GET /api/products/:id/images
router.get("/:id/images", (req, res) => {
  const images = db
    .prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC")
    .all(req.params.id);
  res.json({ success: true, data: images });
});

// POST /api/products/:id/images - upload up to 5 images (farmer only)
router.post("/:id/images", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can upload images", "forbidden");

  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND farmer_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return err(res, 404, "Product not found or not yours", "not_found");

  upload.array("images", 5)(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === "LIMIT_FILE_SIZE")
        return err(res, 400, "Each image must be 5 MB or smaller", "file_too_large");
      if (uploadErr.code === "LIMIT_UNEXPECTED_FILE")
        return err(res, 400, "Maximum 5 images allowed", "too_many_files");
      if (uploadErr.code === "INVALID_TYPE")
        return err(res, 400, uploadErr.message, "invalid_file_type");
      return err(res, 400, "Upload failed", "upload_error");
    }
    if (!req.files || req.files.length === 0)
      return err(res, 400, "No image files provided", "no_file");

    // Check existing count
    const existing = db
      .prepare("SELECT COUNT(*) as count FROM product_images WHERE product_id = ?")
      .get(req.params.id).count;

    if (existing + req.files.length > 5)
      return err(res, 400, `Cannot exceed 5 images. Currently have ${existing}.`, "too_many_files");

    const maxOrder = db
      .prepare("SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?")
      .get(req.params.id).m ?? -1;

    const insert = db.prepare(
      "INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)"
    );
    const insertMany = db.transaction((files) => {
      files.forEach((f, i) => {
        insert.run(req.params.id, `/uploads/${f.filename}`, maxOrder + 1 + i);
      });
    });
    insertMany(req.files);

    const images = db
      .prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC")
      .all(req.params.id);

    // Keep product.image_url in sync with first image
    if (images.length > 0) {
      db.prepare("UPDATE products SET image_url = ? WHERE id = ?").run(images[0].url, req.params.id);
    }

    res.json({ success: true, data: images });
  });
});

// DELETE /api/products/:id/images/:imgId - farmer only
router.delete("/:id/images/:imgId", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can delete images", "forbidden");

  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND farmer_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return err(res, 404, "Product not found or not yours", "not_found");

  const image = db
    .prepare("SELECT * FROM product_images WHERE id = ? AND product_id = ?")
    .get(req.params.imgId, req.params.id);
  if (!image) return err(res, 404, "Image not found", "not_found");

  db.prepare("DELETE FROM product_images WHERE id = ?").run(req.params.imgId);

  // Try to delete file from disk
  const fs = require("fs");
  const filePath = require("path").join(__dirname, "../../uploads", require("path").basename(image.url));
  try { fs.unlinkSync(filePath); } catch {}

  // Sync product.image_url to new first image
  const first = db
    .prepare("SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1")
    .get(req.params.id);
  db.prepare("UPDATE products SET image_url = ? WHERE id = ?").run(first?.url ?? null, req.params.id);

  res.json({ success: true, message: "Image deleted" });
});

// PATCH /api/products/:id/images/reorder - update sort_order for all images
router.patch("/:id/images/reorder", auth, (req, res) => {
  if (req.user.role !== "farmer")
    return err(res, 403, "Only farmers can reorder images", "forbidden");

  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND farmer_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return err(res, 404, "Product not found or not yours", "not_found");

  // Expect body: { order: [{ id, sort_order }, ...] }
  const { order } = req.body;
  if (!Array.isArray(order)) return err(res, 400, "order must be an array", "validation_error");

  const update = db.prepare("UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?");
  const reorder = db.transaction((items) => {
    items.forEach(({ id, sort_order }) => update.run(sort_order, id, req.params.id));
  });
  reorder(order);

  // Sync product.image_url to new first image
  const first = db
    .prepare("SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1")
    .get(req.params.id);
  if (first) db.prepare("UPDATE products SET image_url = ? WHERE id = ?").run(first.url, req.params.id);

  const images = db
    .prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC")
    .all(req.params.id);
  res.json({ success: true, data: images });
});

module.exports = router;
