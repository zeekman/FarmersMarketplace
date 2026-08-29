/**
 * POST /api/products/import
 *
 * Accepts:
 *   - Content-Type: application/json  → body is an array of product objects
 *   - Content-Type: multipart/form-data with a `file` CSV field
 *
 * Validates each row with the same rules as POST /api/products.
 * Detects duplicates by (name, farmer_id) — skips with a warning.
 * Max 500 rows; returns { imported, skipped, errors }.
 */

const router = require('express').Router();
const multer = require('multer');
const { parse } = require('csv-parse');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');

const MAX_IMPORT = 500;
const VALID_ALLERGENS = ['gluten', 'nuts', 'dairy', 'eggs', 'soy', 'shellfish'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only CSV files are allowed'), false);
  },
});

// Validate a single product row; returns { product } or { error }
function validateRow(row) {
  const name = (row.name || '').trim();
  if (!name) return { error: 'name is required' };

  const price = parseFloat(row.price);
  if (isNaN(price) || price <= 0) return { error: 'price must be a positive number' };

  const quantity = parseInt(row.quantity, 10);
  if (isNaN(quantity) || quantity <= 0) return { error: 'quantity must be a positive integer' };

  // allergens
  const allergenInput = row.allergens;
  let allergens = null;
  if (allergenInput !== undefined && allergenInput !== null && allergenInput !== '') {
    const arr = Array.isArray(allergenInput)
      ? allergenInput
      : String(allergenInput).split(',').map((a) => a.trim()).filter(Boolean);
    const invalid = arr.find((a) => !VALID_ALLERGENS.includes(a));
    if (invalid) return { error: `Invalid allergen: "${invalid}". Must be one of: ${VALID_ALLERGENS.join(', ')}` };
    allergens = arr.length > 0 ? JSON.stringify(arr) : null;
  }

  return {
    product: {
      name: sanitizeText(name),
      description: sanitizeText((row.description || '').trim()),
      price,
      quantity,
      unit: sanitizeText((row.unit || 'unit').trim()),
      category: sanitizeText((row.category || 'other').trim()),
      allergens,
    },
  };
}

// Parse CSV buffer → array of plain objects
function parseCsv(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
    parser.on('data', (r) => rows.push(r));
    parser.on('end', () => resolve(rows));
    parser.on('error', reject);
  });
}

// Shared import logic
async function runImport(rows, farmerId, res) {
  if (rows.length > MAX_IMPORT) {
    return res.status(413).json({
      success: false,
      error: 'too_large',
      message: `Maximum ${MAX_IMPORT} rows per import`,
      code: 'too_large',
    });
  }

  // Load existing (name, farmer_id) pairs once for duplicate detection
  const { rows: existing } = await db.query(
    'SELECT LOWER(name) AS lname FROM products WHERE farmer_id = $1',
    [farmerId]
  );
  const existingNames = new Set(existing.map((r) => r.lname));

  const results = { imported: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const row = rows[i];

    const { product, error } = validateRow(row);
    if (error) {
      results.skipped++;
      results.errors.push({ row: rowNum, error });
      continue;
    }

    // Duplicate detection: (name, farmer_id)
    if (existingNames.has(product.name.toLowerCase())) {
      results.skipped++;
      results.errors.push({ row: rowNum, error: `Duplicate: product "${product.name}" already exists`, skipped: true });
      continue;
    }

    try {
      await db.query(
        `INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, allergens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [farmerId, product.name, product.description, product.category, product.price, product.quantity, product.unit, product.allergens]
      );
      existingNames.add(product.name.toLowerCase()); // prevent intra-batch dupes
      results.imported++;
    } catch (e) {
      results.skipped++;
      results.errors.push({ row: rowNum, error: e.message });
    }
  }

  res.json({ success: true, ...results });
}

// POST /api/products/import
router.post('/', auth, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can import products', 'forbidden');

  const ct = req.headers['content-type'] || '';

  try {
    // JSON array body
    if (ct.includes('application/json')) {
      const rows = Array.isArray(req.body) ? req.body : req.body?.products;
      if (!Array.isArray(rows) || rows.length === 0)
        return err(res, 400, 'Request body must be a non-empty array of products', 'validation_error');
      return await runImport(rows, req.user.id, res);
    }

    // CSV file upload (multipart/form-data)
    if (!req.file) return err(res, 400, 'Provide a CSV file (field: file) or JSON body', 'validation_error');
    const rows = await parseCsv(req.file.buffer);
    if (rows.length === 0) return err(res, 400, 'CSV file is empty', 'validation_error');
    return await runImport(rows, req.user.id, res);
  } catch (e) {
    err(res, 400, 'Failed to parse input: ' + e.message, 'parse_error');
  }
});

module.exports = router;
