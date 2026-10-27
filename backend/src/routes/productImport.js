/**
 * POST /api/products/import
 * POST /api/v1/products/import
 *
 * Unified, validated, transactional bulk product import endpoint.
 *
 * Features
 * ────────
 * • Strips UTF-8 BOM (Excel "CSV UTF-8" default)
 * • Accepts ?delimiter=; (or any single char, default ,)
 * • Lowercases and trims CSV headers
 * • Validates every row with the same rules as POST /products (via productService.validateRow)
 * • Supports ?dry_run=true  → returns {valid, errors, duplicates} without writing
 * • Supports ?on_duplicate=skip|update|create (default skip)
 * • Supports ?mode=default|all_or_nothing
 *     - default: bad rows skipped, good rows committed together
 *     - all_or_nothing: any bad row rolls back everything
 * • Runs inside one db.withTransaction; per-row SAVEPOINTs guard good rows from bad neighbours
 * • Fires batched post-create side effects (price_history, SSE, waitlist notifications, cache)
 * • Returns: { success, created, updated, skipped, errors: [{ line, field, message }] }
 *
 * Template download
 * ─────────────────
 * GET /api/products/import/template
 */

'use strict';

const router = require('express').Router();
const multer = require('multer');
const { parse } = require('csv-parse');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const {
  insertProduct,
  fireBatchPostCreateEffects,
  validateRow,
} = require('../services/productService');

const MAX_IMPORT = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Strip a leading UTF-8 BOM (\uFEFF / 0xEF 0xBB 0xBF) from a Buffer or string.
 */
function stripBom(input) {
  if (Buffer.isBuffer(input)) {
    if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
      return input.slice(3);
    }
    return input;
  }
  return typeof input === 'string' && input.charCodeAt(0) === 0xfeff
    ? input.slice(1)
    : input;
}

/**
 * Parse CSV buffer → array of plain objects with lowercased, trimmed headers.
 * @param {Buffer} buffer
 * @param {string} delimiter  single character, default ','
 */
function parseCsv(buffer, delimiter = ',') {
  return new Promise((resolve, reject) => {
    const rows = [];
    const clean = stripBom(buffer);
    const parser = parse(clean, {
      columns: (hdrs) => hdrs.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      delimiter,
    });
    parser.on('data', (row) => rows.push(row));
    parser.on('end', () => resolve(rows));
    parser.on('error', reject);
  });
}

/**
 * Load the set of existing lowercase+trimmed product names for a farmer.
 * Used for duplicate detection.
 */
async function loadExistingNames(farmerId) {
  const { rows } = await db.query(
    `SELECT LOWER(TRIM(name)) AS lname FROM products WHERE farmer_id = $1`,
    [farmerId]
  );
  return new Set(rows.map((r) => r.lname));
}

// ─── Core import logic ─────────────────────────────────────────────────────

/**
 * Run the import pipeline (or dry-run) for a set of rows.
 *
 * @param {object[]} rows       - raw row objects from CSV/JSON
 * @param {number}   farmerId
 * @param {object}   opts
 * @param {boolean}  opts.dryRun
 * @param {string}   opts.onDuplicate  'skip' | 'update' | 'create'
 * @param {string}   opts.mode         'default' | 'all_or_nothing'
 * @returns {Promise<object>} shape: { created, updated, skipped, errors, valid? (dry_run) }
 */
async function runImport(rows, farmerId, opts) {
  const { dryRun = false, onDuplicate = 'skip', mode = 'default' } = opts;

  if (rows.length > MAX_IMPORT) {
    const e = new Error(`Maximum ${MAX_IMPORT} rows per import`);
    e.code = 'too_large';
    e.status = 413;
    throw e;
  }

  // Validate all rows first (no DB calls)
  const validated = [];   // { rowNum, product }
  const errorItems = [];  // { line, field, message }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // header is line 1, data starts at line 2
    const result = validateRow(rows[i]);
    if (result.errors) {
      for (const msg of result.errors) {
        errorItems.push({ line: rowNum, field: null, message: msg });
      }
    } else {
      validated.push({ rowNum, product: result.product });
    }
  }

  // all_or_nothing: bail before touching the DB if any row is invalid
  if (mode === 'all_or_nothing' && errorItems.length > 0) {
    return { created: 0, updated: 0, skipped: rows.length, errors: errorItems };
  }

  // Dry run: just return the preview
  if (dryRun) {
    const existingNames = await loadExistingNames(farmerId);
    const duplicates = validated
      .filter((v) => existingNames.has(v.product.name.toLowerCase()))
      .map((v) => ({ line: v.rowNum, name: v.product.name }));
    return {
      dryRun: true,
      valid: validated.map((v) => ({ line: v.rowNum, name: v.product.name })),
      errors: errorItems,
      duplicates,
    };
  }

  // Real import — one outer transaction, per-row savepoints
  const createdIds = [];
  const results = {
    created: 0,
    updated: 0,
    skipped: errorItems.length,
    errors: [...errorItems],
  };

  await db.withTransaction(async (tx) => {
    // Load existing names inside the transaction for consistency
    const existingNames = await loadExistingNames(farmerId);
    // Track intra-batch names to prevent duplicate rows within the same upload
    const seenInBatch = new Set();

    for (const { rowNum, product } of validated) {
      const lname = product.name.toLowerCase();

      const isDuplicate = existingNames.has(lname) || seenInBatch.has(lname);

      if (isDuplicate) {
        if (onDuplicate === 'skip') {
          results.skipped++;
          results.errors.push({
            line: rowNum,
            field: 'name',
            message: `Duplicate: "${product.name}" already exists`,
          });
          continue;
        }

        if (onDuplicate === 'update') {
          // SAVEPOINT so this row's failure doesn't kill others
          await tx.query('SAVEPOINT import_row');
          try {
            await tx.query(
              `UPDATE products
                  SET price = $1, quantity = $2, description = $3,
                      unit = $4, category = $5, allergens = $6
                WHERE farmer_id = $7 AND LOWER(TRIM(name)) = LOWER($8)`,
              [
                product.price,
                product.quantity,
                product.description,
                product.unit,
                product.category,
                product.allergens,
                farmerId,
                product.name,
              ]
            );
            await tx.query('RELEASE SAVEPOINT import_row');
            results.updated++;
            seenInBatch.add(lname);
          } catch (e) {
            await tx.query('ROLLBACK TO SAVEPOINT import_row');
            await tx.query('RELEASE SAVEPOINT import_row');
            results.skipped++;
            results.errors.push({ line: rowNum, field: null, message: e.message });
          }
          continue;
        }

        // on_duplicate === 'create': fall through to insert without duplicate check
      }

      // Insert with SAVEPOINT guard
      await tx.query('SAVEPOINT import_row');
      try {
        const { id } = await insertProduct(tx, farmerId, product);
        await tx.query('RELEASE SAVEPOINT import_row');
        createdIds.push(id);
        results.created++;
        // prevent duplicate intra-batch inserts
        existingNames.add(lname);
        seenInBatch.add(lname);
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT import_row');
        await tx.query('RELEASE SAVEPOINT import_row');

        if (mode === 'all_or_nothing') {
          // Throw so the outer withTransaction rolls back everything
          throw e;
        }
        results.skipped++;
        results.errors.push({ line: rowNum, field: null, message: e.message });
      }
    }
  });

  // Fire batched post-create side effects (cache, SSE, waitlist) outside the tx
  if (createdIds.length > 0) {
    fireBatchPostCreateEffects(createdIds).catch(() => {});
  }

  return results;
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/products/import/template
 * Download a CSV template for bulk import.
 */
router.get('/template', (_req, res) => {
  const csv =
    'name,description,price,quantity,unit,category,allergens\n' +
    'Organic Tomatoes,Fresh organic tomatoes,2.50,100,kg,vegetables,\n' +
    'Free Range Eggs,Farm fresh eggs,5.00,50,dozen,dairy,eggs\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.csv');
  res.send(csv);
});

/**
 * POST /api/products/import
 *
 * Accepts:
 *   - multipart/form-data   with a `file` CSV field
 *   - application/json      body is an array of product objects (or { products: [...] })
 *
 * Query params:
 *   - dry_run=true            preview without writing
 *   - on_duplicate=skip|update|create   default: skip
 *   - mode=default|all_or_nothing       default: default
 *   - delimiter=;             CSV column separator (default: ,)
 */
router.post('/', auth, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Only farmers can import products', 'forbidden');
  }

  const dryRun = req.query.dry_run === 'true' || req.query.dry_run === '1';
  const onDuplicate = ['skip', 'update', 'create'].includes(req.query.on_duplicate)
    ? req.query.on_duplicate
    : 'skip';
  const mode = req.query.mode === 'all_or_nothing' ? 'all_or_nothing' : 'default';
  const delimiter =
    typeof req.query.delimiter === 'string' && req.query.delimiter.length === 1
      ? req.query.delimiter
      : ',';

  const ct = req.headers['content-type'] || '';

  try {
    let rows;

    if (ct.includes('application/json')) {
      const body = req.body;
      rows = Array.isArray(body) ? body : Array.isArray(body?.products) ? body.products : null;
      if (!rows || rows.length === 0) {
        return err(
          res,
          400,
          'Request body must be a non-empty array (or { products: [...] })',
          'validation_error'
        );
      }
    } else {
      if (!req.file) {
        return err(
          res,
          400,
          'Provide a CSV file (field: file) or a JSON body',
          'validation_error'
        );
      }

      rows = await parseCsv(req.file.buffer, delimiter);

      if (rows.length === 0) {
        return err(res, 400, 'CSV file is empty or has no data rows', 'validation_error');
      }

      // Verify required columns are present (after header normalisation)
      const headers = Object.keys(rows[0]);
      const REQUIRED = ['name', 'price', 'quantity'];
      const missing = REQUIRED.filter((h) => !headers.includes(h));
      if (missing.length > 0) {
        return err(
          res,
          400,
          `Missing required columns: ${missing.join(', ')}`,
          'missing_columns'
        );
      }
    }

    const result = await runImport(rows, req.user.id, { dryRun, onDuplicate, mode });

    // unified response shape
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({
        success: false,
        error: e.code || 'error',
        message: e.message,
      });
    }
    err(res, 400, 'Failed to process import: ' + e.message, 'parse_error');
  }
});

module.exports = router;
