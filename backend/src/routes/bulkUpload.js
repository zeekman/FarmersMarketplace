const router = require('express').Router();
const multer = require('multer');
const { parse } = require('csv-parse');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// Configure multer for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
});

// POST /api/products/bulk - bulk upload products via CSV
router.post('/', auth, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can upload products', 'forbidden');

  if (!req.file)
    return err(res, 400, 'No CSV file uploaded', 'validation_error');

  const results = { created: 0, skipped: 0, errors: [] };

  try {
    const records = await new Promise((resolve, reject) => {
      const rows = [];
      const parser = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      parser.on('data', (row) => rows.push(row));
      parser.on('end', () => resolve(rows));
      parser.on('error', reject);
    });

    // Limit to 500 rows
    if (records.length > 500) {
      return err(res, 400, 'Maximum 500 rows per upload', 'validation_error');
    }

    const insertStmt = db.prepare(
      'INSERT INTO products (farmer_id, name, description, price, quantity, unit, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    const transaction = db.transaction((rows) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // +2 for 1-indexed and header row

        // Validate required fields
        if (!row.name || row.name.trim() === '') {
          results.skipped++;
          results.errors.push({ row: rowNum, error: 'name is required' });
          continue;
        }

        const price = parseFloat(row.price);
        if (isNaN(price) || price <= 0) {
          results.skipped++;
          results.errors.push({ row: rowNum, error: 'price must be a positive number' });
          continue;
        }

        const quantity = parseInt(row.quantity, 10);
        if (isNaN(quantity) || quantity <= 0) {
          results.skipped++;
          results.errors.push({ row: rowNum, error: 'quantity must be a positive integer' });
          continue;
        }

        try {
          insertStmt.run(
            req.user.id,
            row.name.trim(),
            row.description?.trim() || null,
            price,
            quantity,
            row.unit?.trim() || 'unit',
            row.category?.trim() || 'other'
          );
          results.created++;
        } catch (e) {
          results.skipped++;
          results.errors.push({ row: rowNum, error: e.message });
        }
      }
    });

    transaction(records);

    res.json({
      success: true,
      created: results.created,
      skipped: results.skipped,
      errors: results.errors,
    });
  } catch (e) {
    err(res, 400, 'Failed to parse CSV: ' + e.message, 'parse_error');
  }
});

// GET /api/products/bulk/template - download CSV template
router.get('/template', (req, res) => {
  const csv = 'name,description,price,quantity,unit,category\nOrganic Tomatoes,Fresh organic tomatoes from the farm,2.50,100,kg,vegetables\nFree Range Eggs,Farm fresh free range eggs,5.00,50,dozen,dairy\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=product-template.csv');
  res.send(csv);
});

module.exports = router;
