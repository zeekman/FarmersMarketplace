const router = require('express').Router();
const { stringify } = require('csv-stringify');
const { PassThrough } = require('stream');
const PDFDocument = require('pdfkit');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

function farmerOnly(req, res, next) {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  next();
}

const BATCH_SIZE = 1000;

// Streaming CSV helper - fetches data in batches to avoid OOM
function streamCsv(res, filename, columns, queryFn) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const stringifier = stringify({ header: true, columns });
  stringifier.pipe(res);

  let offset = 0;
  let done = false;
  let fetching = false;

  async function fetchNext() {
    if (fetching || done) return;
    fetching = true;
    try {
      const { rows } = await queryFn(offset, BATCH_SIZE);
      if (rows.length === 0) {
        stringifier.end();
        done = true;
        return;
      }
      for (const row of rows) {
        stringifier.write(row);
      }
      offset += BATCH_SIZE;
    } catch (e) {
      res.status(500).end('CSV export error');
      done = true;
    } finally {
      fetching = false;
    }
  }

  // Start fetching and continue as stream drains
  fetchNext();
  stringifier.on('drain', fetchNext);
}

function buildPdf(res, filename, title, columns, rows, totals) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // Header
  doc.fontSize(16).fillColor('#2d6a4f').text(title, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#555').text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
  doc.moveDown(1);

  // Table header
  const colW = Math.floor((doc.page.width - 80) / columns.length);
  let x = 40;
  doc.fontSize(9).fillColor('#fff');
  doc.rect(40, doc.y, doc.page.width - 80, 18).fill('#2d6a4f');
  columns.forEach((col) => {
    doc.fillColor('#fff').text(col.header, x + 3, doc.y - 15, { width: colW - 4, lineBreak: false });
    x += colW;
  });
  doc.moveDown(0.3);

  // Rows
  rows.forEach((row, i) => {
    const rowY = doc.y;
    if (i % 2 === 0) doc.rect(40, rowY, doc.page.width - 80, 16).fill('#f4f9f6');
    x = 40;
    columns.forEach((col) => {
      const val = row[col.key] ?? '';
      doc.fontSize(8).fillColor('#222').text(String(val), x + 3, rowY + 3, { width: colW - 4, lineBreak: false });
      x += colW;
    });
    doc.y = rowY + 16;
    if (doc.y > doc.page.height - 60) doc.addPage();
  });

  // Totals
  if (totals) {
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#2d6a4f');
    Object.entries(totals).forEach(([k, v]) => doc.text(`${k}: ${v}`));
  }

  doc.end();
}

// GET /api/products/export?format=csv|pdf
router.get('/products/export', auth, farmerOnly, async (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();
  if (!['csv', 'pdf'].includes(format)) return err(res, 400, 'format must be csv or pdf', 'validation_error');

  const columns = [
    { key: 'id',                  header: 'ID' },
    { key: 'name',                header: 'Name' },
    { key: 'category',            header: 'Category' },
    { key: 'price',               header: 'Price (XLM)' },
    { key: 'quantity',            header: 'Quantity' },
    { key: 'unit',                header: 'Unit' },
    { key: 'description',         header: 'Description' },
    { key: 'low_stock_threshold', header: 'Low Stock Threshold' },
    { key: 'created_at',          header: 'Created At' },
  ];

  if (format === 'csv') {
    const queryFn = async (offset, limit) => {
      const { rows } = await db.query(
        `SELECT id, name, category, price, quantity, unit, description, low_stock_threshold, created_at
         FROM products WHERE farmer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      );
      return { rows };
    };
    return streamCsv(res, 'products.csv', columns, queryFn);
  }

  // PDF format - load all data (PDFs are inherently document-sized)
  const { rows } = await db.query(
    `SELECT id, name, category, price, quantity, unit, description, low_stock_threshold, created_at
     FROM products WHERE farmer_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  buildPdf(res, 'products.pdf', 'My Product Inventory', columns, rows, {
    'Total products': rows.length,
    'Total stock': rows.reduce((s, r) => s + (r.quantity || 0), 0),
  });
});

// GET /api/orders/sales/export?format=csv|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/orders/sales/export', auth, farmerOnly, async (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();
  if (!['csv', 'pdf'].includes(format)) return err(res, 400, 'format must be csv or pdf', 'validation_error');

  const baseParams = [req.user.id];
  let dateFilter = '';
  if (req.query.from) { dateFilter += ` AND o.created_at >= $${baseParams.length + 1}`; baseParams.push(req.query.from); }
  if (req.query.to)   { dateFilter += ` AND o.created_at <= $${baseParams.length + 1}`; baseParams.push(req.query.to + 'T23:59:59'); }

  const columns = [
    { key: 'id',               header: 'Order ID' },
    { key: 'product_name',     header: 'Product' },
    { key: 'buyer_name',       header: 'Buyer' },
    { key: 'quantity',         header: 'Qty' },
    { key: 'total_price',      header: 'Total (XLM)' },
    { key: 'status',           header: 'Status' },
    { key: 'stellar_tx_hash',  header: 'TX Hash' },
    { key: 'created_at',       header: 'Date' },
  ];

  if (format === 'csv') {
    const queryFn = async (offset, limit) => {
      const params = [...baseParams, limit, offset];
      const { rows } = await db.query(
        `SELECT o.id, p.name as product_name, u.name as buyer_name,
                o.quantity, o.total_price, o.status, o.stellar_tx_hash, o.created_at
         FROM orders o
         JOIN products p ON o.product_id = p.id
         JOIN users u ON o.buyer_id = u.id
         WHERE p.farmer_id = $1${dateFilter}
         ORDER BY o.created_at DESC
         LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
        params
      );
      return { rows };
    };
    return streamCsv(res, 'sales.csv', columns, queryFn);
  }

  // PDF format - load all data
  const { rows } = await db.query(
    `SELECT o.id, p.name as product_name, u.name as buyer_name,
            o.quantity, o.total_price, o.status, o.stellar_tx_hash, o.created_at
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     WHERE p.farmer_id = $1${dateFilter}
     ORDER BY o.created_at DESC`,
    baseParams
  );

  const totalXlm = rows.reduce((s, r) => s + parseFloat(r.total_price || 0), 0).toFixed(7);
  buildPdf(res, 'sales.pdf', 'Sales History', columns, rows, {
    'Total orders': rows.length,
    'Total revenue (XLM)': totalXlm,
  });
});

module.exports = router;
