/**
 * Tests for the unified POST /api/products/import endpoint (issue #1607).
 *
 * Coverage
 * ────────
 * 1.  Table-driven validation parity between /products/import and /products/bulk
 * 2.  XSS sanitisation of the name field
 * 3.  Strict float/price rejection (2.50abc, 1e308, >7 decimals)
 * 4.  Strict integer/quantity rejection (10.9)
 * 5.  ?dry_run=true returns preview, writes nothing
 * 6.  Transaction atomicity (all_or_nothing mode)
 * 7.  Duplicate skip with on_duplicate=skip (default)
 * 8.  BOM-prefixed CSV from Excel
 * 9.  Row-number line numbering (CSV line numbers, i+2)
 * 10. on_duplicate=update
 * 11. Missing required columns → 400 missing_columns
 * 12. More than 500 rows → 413 too_large
 * 13. /products/bulk returns Deprecation header
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const mockDb = jest.requireMock('../db/schema');

// Mount BOTH endpoints so we can test parity
jest.mock('../routes', () => {
  const express = require('express');
  const router = express.Router();
  router.use('/api/products/import', require('../routes/productImport'));
  router.use('/api/products/bulk', require('../routes/bulkUpload'));
  return router;
});

const app = require('../app');

const farmerToken = jwt.sign({ id: 1, role: 'farmer' }, process.env.JWT_SECRET);
const buyerToken = jwt.sign({ id: 2, role: 'buyer' }, process.env.JWT_SECRET);

// ─── Helpers ────────────────────────────────────────────────────────────────

function importCsv(csvContent, qs = '') {
  return request(app)
    .post(`/api/products/import${qs}`)
    .set('Authorization', `Bearer ${farmerToken}`)
    .attach('file', Buffer.from(csvContent), { filename: 'products.csv', contentType: 'text/csv' });
}

function bulkCsv(csvContent, qs = '') {
  return request(app)
    .post(`/api/products/bulk${qs}`)
    .set('Authorization', `Bearer ${farmerToken}`)
    .attach('file', Buffer.from(csvContent), { filename: 'products.csv', contentType: 'text/csv' });
}

/** Set up a passing mock for insert operations */
function setupPassingMocks() {
  let idCounter = 1;
  mockDb.query.mockImplementation(async (sql) => {
    if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
    if (/SELECT.*LOWER.*TRIM.*name.*FROM products.*farmer_id/i.test(sql))
      return { rows: [], rowCount: 0 };
    if (/SELECT quantity FROM products/i.test(sql)) return { rows: [{ quantity: 100 }], rowCount: 1 };
    if (/SELECT.*waitlist/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/SAVEPOINT/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/RELEASE SAVEPOINT/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/ROLLBACK TO SAVEPOINT/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO products/i.test(sql)) return { rows: [{ id: idCounter++ }], rowCount: 1 };
    if (/INSERT INTO price_history/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  mockDb.withTransaction.mockImplementation((work) => work(mockDb));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/products/import', () => {
  beforeEach(() => {
    setupPassingMocks();
  });

  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  it('returns 403 for non-farmer', async () => {
    const csv = 'name,price,quantity\nTomatoes,2.5,100\n';
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${buyerToken}`)
      .attach('file', Buffer.from(csv), { filename: 'products.csv', contentType: 'text/csv' });
    expect(res.status).toBe(403);
  });

  // ── 2. Missing required columns ────────────────────────────────────────────
  it('returns 400 missing_columns when price is absent', async () => {
    const csv = 'name,quantity\nTomatoes,100\n';
    const res = await importCsv(csv);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('missing_columns');
    expect(res.body.message).toContain('price');
  });

  it('returns 400 missing_columns listing all absent required headers', async () => {
    const csv = 'description,unit\nFresh,kg\n';
    const res = await importCsv(csv);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('missing_columns');
    expect(res.body.message).toContain('name');
    expect(res.body.message).toContain('price');
    expect(res.body.message).toContain('quantity');
  });

  // ── 3. Table-driven validation — same errors from both endpoints ───────────
  const INVALID_ROWS = [
    {
      desc: 'empty name',
      csv: 'name,price,quantity\n,2.5,100\n',
      expectMsg: /name is required/i,
    },
    {
      desc: 'price with trailing chars (2.50abc)',
      csv: 'name,price,quantity\nTomatoes,2.50abc,100\n',
      expectMsg: /not a valid number/i,
    },
    {
      desc: 'price = 1e308 (overflow)',
      csv: 'name,price,quantity\nTomatoes,1e308,100\n',
      expectMsg: /not a valid number/i,
    },
    {
      desc: 'price with > 7 decimal places',
      csv: 'name,price,quantity\nTomatoes,2.123456789,100\n',
      expectMsg: /at most 7 decimal places/i,
    },
    {
      desc: 'quantity with decimal (10.9)',
      csv: 'name,price,quantity\nTomatoes,2.5,10.9\n',
      expectMsg: /whole number/i,
    },
    {
      desc: 'negative price',
      csv: 'name,price,quantity\nTomatoes,-1,100\n',
      expectMsg: /positive number/i,
    },
    {
      desc: 'zero quantity',
      csv: 'name,price,quantity\nTomatoes,2.5,0\n',
      expectMsg: /positive integer/i,
    },
    {
      desc: 'invalid allergen',
      csv: 'name,price,quantity,allergens\nTomatoes,2.5,100,peanuts\n',
      expectMsg: /invalid allergen/i,
    },
  ];

  describe('row-level validation errors', () => {
    for (const tc of INVALID_ROWS) {
      it(`rejects: ${tc.desc}`, async () => {
        const res = await importCsv(tc.csv);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // The invalid row is skipped and reported in errors
        expect(res.body.errors).toHaveLength(1);
        expect(res.body.errors[0].message).toMatch(tc.expectMsg);
        expect(res.body.created).toBe(0);
      });
    }
  });

  // ── 4. Validation parity: /products/bulk gives identical errors ────────────
  describe('validation parity — /products/bulk forwards to /products/import', () => {
    for (const tc of INVALID_ROWS) {
      it(`bulk also rejects: ${tc.desc}`, async () => {
        const res = await bulkCsv(tc.csv);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.errors).toHaveLength(1);
        expect(res.body.errors[0].message).toMatch(tc.expectMsg);
        expect(res.body.created).toBe(0);
      });
    }
  });

  // ── 5. XSS sanitisation ────────────────────────────────────────────────────
  it('sanitises HTML in name field (XSS)', async () => {
    // name with a <script> tag — the DB insert must NOT contain raw HTML
    const csv = 'name,price,quantity\n<script>alert(1)</script>,2.5,100\n';
    const res = await importCsv(csv);
    expect(res.status).toBe(200);
    // Verify the INSERT call received sanitised text, not the raw script tag
    const insertCall = mockDb.query.mock.calls.find((args) =>
      /INSERT INTO products/i.test(args[0])
    );
    expect(insertCall).toBeDefined();
    const insertedName = insertCall[1][1]; // second param is name
    expect(insertedName).not.toContain('<script>');
    expect(insertedName).not.toContain('alert(1)');
  });

  // ── 6. Line numbers are CSV line numbers (i + 2) ─────────────────────────
  it('reports correct CSV line numbers in errors (i+2)', async () => {
    const csv = [
      'name,price,quantity',
      'Tomatoes,2.5,100',    // line 2 — valid
      ',1.0,10',             // line 3 — error: name required
      'Eggs,bad,50',         // line 4 — error: bad price
    ].join('\n');
    const res = await importCsv(csv);
    expect(res.status).toBe(200);
    const errLines = res.body.errors.map((e) => e.line);
    expect(errLines).toContain(3);
    expect(errLines).toContain(4);
  });

  // ── 7. dry_run=true ────────────────────────────────────────────────────────
  it('dry_run returns preview without writing any rows', async () => {
    const csv = 'name,price,quantity\nTomatoes,2.5,100\nBadRow,,100\n';
    // Row count before
    const countBefore = mockDb.query.mock.calls.filter((c) =>
      /INSERT INTO products/i.test(c[0])
    ).length;

    const res = await importCsv(csv, '?dry_run=true');
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body).toHaveProperty('valid');
    expect(res.body).toHaveProperty('errors');
    expect(res.body).toHaveProperty('duplicates');

    // No INSERT INTO products should have been called
    const insertCalls = mockDb.query.mock.calls.filter((c) =>
      /INSERT INTO products/i.test(c[0])
    );
    expect(insertCalls.length).toBe(countBefore);
  });

  it('dry_run valid rows include name and line', async () => {
    const csv = 'name,price,quantity\nOrganic Tomatoes,2.50,100\n';
    const res = await importCsv(csv, '?dry_run=true');
    expect(res.status).toBe(200);
    expect(res.body.valid).toHaveLength(1);
    expect(res.body.valid[0]).toMatchObject({ line: 2, name: 'Organic Tomatoes' });
  });

  // ── 8. Duplicate skip (on_duplicate=skip default) ─────────────────────────
  it('skips duplicate products by default (on_duplicate=skip)', async () => {
    // Simulate "Tomatoes" already existing for this farmer
    mockDb.query.mockImplementation(async (sql, params) => {
      if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
      if (/SELECT.*LOWER.*TRIM.*name.*FROM products.*farmer_id/i.test(sql))
        return { rows: [{ lname: 'tomatoes' }], rowCount: 1 };
      if (/SELECT quantity FROM products/i.test(sql)) return { rows: [{ quantity: 100 }], rowCount: 1 };
      if (/SELECT.*waitlist/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/SAVEPOINT|RELEASE|ROLLBACK/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    mockDb.withTransaction.mockImplementation((work) => work(mockDb));

    const csv = 'name,price,quantity\nTomatoes,2.5,100\n';
    const res = await importCsv(csv);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].message).toMatch(/duplicate/i);
  });

  it('re-uploading the same file skips all rows (0 new products)', async () => {
    // Both rows already exist
    mockDb.query.mockImplementation(async (sql) => {
      if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
      if (/SELECT.*LOWER.*TRIM.*name.*FROM products.*farmer_id/i.test(sql))
        return {
          rows: [{ lname: 'tomatoes' }, { lname: 'free range eggs' }],
          rowCount: 2,
        };
      if (/SAVEPOINT|RELEASE|ROLLBACK/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    mockDb.withTransaction.mockImplementation((work) => work(mockDb));

    const csv =
      'name,price,quantity\nTomatoes,2.5,100\nFree Range Eggs,5.0,50\n';
    const res = await importCsv(csv);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);

    const insertCalls = mockDb.query.mock.calls.filter((c) =>
      /INSERT INTO products/i.test(c[0])
    );
    expect(insertCalls).toHaveLength(0);
  });

  // ── 9. on_duplicate=update ─────────────────────────────────────────────────
  it('on_duplicate=update updates the matching product', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
      if (/SELECT.*LOWER.*TRIM.*name.*FROM products.*farmer_id/i.test(sql))
        return { rows: [{ lname: 'tomatoes' }], rowCount: 1 };
      if (/SAVEPOINT|RELEASE|ROLLBACK/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/UPDATE products/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    mockDb.withTransaction.mockImplementation((work) => work(mockDb));

    const csv = 'name,price,quantity\nTomatoes,3.00,200\n';
    const res = await importCsv(csv, '?on_duplicate=update');
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);
  });

  // ── 10. Transaction atomicity (all_or_nothing mode) ────────────────────────
  it('mode=all_or_nothing returns 0 created when any row is invalid', async () => {
    const csv = [
      'name,price,quantity',
      'ValidProduct,2.5,100',
      'BadProduct,,50',       // missing price → validation error
    ].join('\n');

    const res = await importCsv(csv, '?mode=all_or_nothing');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toBe(2); // both rows counted as skipped

    // Confirm no INSERT was attempted
    const insertCalls = mockDb.query.mock.calls.filter((c) =>
      /INSERT INTO products/i.test(c[0])
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('mode=default: good rows commit even when other rows fail', async () => {
    let idCounter = 1;
    mockDb.query.mockImplementation(async (sql) => {
      if (/SELECT active FROM users/i.test(sql)) return { rows: [{ active: 1 }], rowCount: 1 };
      if (/SELECT.*LOWER.*TRIM.*name.*FROM products.*farmer_id/i.test(sql))
        return { rows: [], rowCount: 0 };
      if (/SELECT quantity FROM products/i.test(sql)) return { rows: [{ quantity: 100 }], rowCount: 1 };
      if (/SELECT.*waitlist/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/SAVEPOINT|RELEASE|ROLLBACK/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO products/i.test(sql)) return { rows: [{ id: idCounter++ }], rowCount: 1 };
      if (/INSERT INTO price_history/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    mockDb.withTransaction.mockImplementation((work) => work(mockDb));

    const csv = [
      'name,price,quantity',
      'GoodProduct,2.5,100',
      ',1.0,10',              // bad — skipped
      'AnotherGood,3.0,50',
    ].join('\n');

    const res = await importCsv(csv);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toBe(1);
  });

  // ── 11. BOM-prefixed CSV (Excel "CSV UTF-8") ──────────────────────────────
  it('imports a BOM-prefixed CSV file correctly', async () => {
    const bomFile = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'products-bom.csv')
    );
    // Confirm BOM prefix
    expect(bomFile[0]).toBe(0xef);
    expect(bomFile[1]).toBe(0xbb);
    expect(bomFile[2]).toBe(0xbf);

    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .attach('file', bomFile, {
        filename: 'products-bom.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(2);
    expect(res.body.errors).toHaveLength(0);
  });

  // ── 12. Too many rows → 413 ────────────────────────────────────────────────
  it('returns 413 when CSV exceeds 500 rows', async () => {
    const header = 'name,price,quantity\n';
    const rows = Array.from({ length: 501 }, (_, i) => `Product${i},2.5,10`).join('\n');
    const csv = header + rows;
    const res = await importCsv(csv);
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('too_large');
  });

  // ── 13. price_history row is written after insert ─────────────────────────
  it('inserts a price_history row for each created product', async () => {
    const csv = 'name,price,quantity\nTomatoes,2.50,100\n';
    await importCsv(csv);
    const phCalls = mockDb.query.mock.calls.filter((c) =>
      /INSERT INTO price_history/i.test(c[0])
    );
    expect(phCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── 14. ; delimiter support ───────────────────────────────────────────────
  it('accepts semicolon-delimited CSV with ?delimiter=;', async () => {
    const csv = 'name;price;quantity\nTomatoes;2.5;100\n';
    const res = await importCsv(csv, '?delimiter=%3B');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
  });

  // ── 15. JSON body import ──────────────────────────────────────────────────
  it('accepts a JSON body array', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send([{ name: 'Tomatoes', price: 2.5, quantity: 100 }]);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
  });

  // ── 16. dry_run=true on /products/bulk also works (alias) ────────────────
  it('/products/bulk dry_run=true also returns preview', async () => {
    const csv = 'name,price,quantity\nTomatoes,2.5,100\n';
    const res = await bulkCsv(csv, '?dry_run=true');
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body).toHaveProperty('valid');
  });
});

// ─── /products/bulk deprecation headers ──────────────────────────────────────
describe('GET /api/products/bulk/template (deprecated alias)', () => {
  it('returns a Deprecation header', async () => {
    const res = await request(app)
      .post('/api/products/bulk')
      .set('Authorization', `Bearer ${farmerToken}`)
      .attach(
        'file',
        Buffer.from('name,price,quantity\nTomatoes,2.5,100\n'),
        { filename: 'products.csv', contentType: 'text/csv' }
      );
    expect(res.headers).toHaveProperty('deprecation');
    expect(res.headers).toHaveProperty('sunset');
  });
});

// ─── productService.validateRow unit tests ────────────────────────────────────
describe('productService.validateRow', () => {
  const { validateRow } = require('../services/productService');

  const TABLE = [
    { desc: 'valid row',         row: { name: 'Tomatoes', price: '2.50', quantity: '100' }, expectOk: true },
    { desc: 'missing name',      row: { name: '', price: '2.5', quantity: '100' },          expectOk: false, msgPattern: /name is required/i },
    { desc: '2.50abc price',     row: { name: 'A', price: '2.50abc', quantity: '100' },     expectOk: false, msgPattern: /not a valid number/i },
    { desc: '1e308 price',       row: { name: 'A', price: '1e308', quantity: '100' },       expectOk: false, msgPattern: /not a valid number/i },
    { desc: '>7 decimal places', row: { name: 'A', price: '1.12345678', quantity: '100' },  expectOk: false, msgPattern: /7 decimal places/i },
    { desc: 'quantity = 10.9',   row: { name: 'A', price: '2.5', quantity: '10.9' },        expectOk: false, msgPattern: /whole number/i },
    { desc: 'negative price',    row: { name: 'A', price: '-1', quantity: '100' },          expectOk: false, msgPattern: /positive number/i },
    { desc: 'zero qty',          row: { name: 'A', price: '2.5', quantity: '0' },           expectOk: false, msgPattern: /positive integer/i },
    { desc: 'invalid allergen',  row: { name: 'A', price: '2.5', quantity: '10', allergens: 'peanuts' }, expectOk: false, msgPattern: /invalid allergen/i },
    { desc: 'valid allergens',   row: { name: 'A', price: '2.5', quantity: '10', allergens: 'nuts,dairy' }, expectOk: true },
    { desc: 'XSS in name',       row: { name: '<script>x</script>', price: '2.5', quantity: '10' }, expectOk: true, nameCheck: (n) => !n.includes('<script>') },
  ];

  for (const tc of TABLE) {
    it(tc.desc, () => {
      const result = validateRow(tc.row);
      if (tc.expectOk) {
        expect(result).toHaveProperty('product');
        expect(result.errors).toBeUndefined();
        if (tc.nameCheck) {
          expect(tc.nameCheck(result.product.name)).toBe(true);
        }
      } else {
        expect(result).toHaveProperty('errors');
        const allErrors = result.errors.join(' ');
        expect(allErrors).toMatch(tc.msgPattern);
      }
    });
  }

  it('accepts exactly 7 decimal places', () => {
    const r = validateRow({ name: 'A', price: '1.1234567', quantity: '10' });
    expect(r).toHaveProperty('product');
  });

  it('rejects 8 decimal places', () => {
    const r = validateRow({ name: 'A', price: '1.12345678', quantity: '10' });
    expect(r.errors.join(' ')).toMatch(/7 decimal places/i);
  });
});
