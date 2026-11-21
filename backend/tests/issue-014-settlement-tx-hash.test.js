'use strict';

/**
 * Backlog 014 — settlement overwrites orders.stellar_tx_hash.
 *
 * POST /:id/refund, POST /:id/claim and POST /:id/claim-preorder used to run
 * `UPDATE orders SET escrow_status = $1, stellar_tx_hash = $2`, replacing the
 * buyer's payment transaction hash with the refund/claim hash. Receipts,
 * exports, disputes and the buyer's wallet history then pointed at the wrong
 * transaction and the audit trail was lost.
 *
 * Settlements now write settlement_tx_hash / settlement_type / settled_at and
 * never touch stellar_tx_hash.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const { request, app, mockQuery } = require('./setup');
const stellar = jest.requireMock('../src/utils/stellar');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken = jwt.sign({ id: 1, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });

// A well-formed Stellar seed — decryptUserSecretKey() returns valid seeds as-is.
const SEED = `S${'A'.repeat(55)}`;

const PAYMENT_TX_HASH = 'BUYER_PAYMENT_TX_HASH';

// All UPDATE statements issued against orders during the request.
function orderUpdates() {
  return mockQuery.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && /UPDATE\s+orders/i.test(sql)
  );
}

// Route-aware query stub: only the request under test drives the values, so the
// assertions do not depend on the exact number/order of queries the route emits.
function stubQueries(order) {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT active,\s*banned_at FROM users/i.test(sql)) {
      return { rows: [{ active: 1, banned_at: null }], rowCount: 1 };
    }
    if (/SELECT stellar_secret_key/i.test(sql)) {
      return { rows: [{ stellar_secret_key: SEED }], rowCount: 1 };
    }
    if (/^\s*SELECT/i.test(sql) && /FROM orders/i.test(sql)) {
      return { rows: [order], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  stellar.invokeEscrowContract.mockResolvedValue({ txHash: 'REFUND_TX_HASH' });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_HASH');
});

// ── POST /:id/refund ─────────────────────────────────────────────────────────
describe('POST /api/orders/:id/refund — keeps the payment hash', () => {
  const order = {
    id: 10,
    buyer_id: 1,
    farmer_id: 2,
    product_id: 5,
    status: 'paid',
    total_price: 20,
    escrow_status: 'funded',
    escrow_balance_id: 'soroban:10',
    stellar_tx_hash: PAYMENT_TX_HASH,
  };

  test('writes the refund to settlement_* and never to stellar_tx_hash', async () => {
    stubQueries(order);

    const res = await request(app)
      .post('/api/orders/10/refund')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('REFUND_TX_HASH');

    const updates = orderUpdates();
    expect(updates).toHaveLength(1);

    const [sql, params] = updates[0];
    // stellar_tx_hash must not appear in the settlement statement.
    expect(sql).not.toContain('stellar_tx_hash');
    expect(sql).toContain('settlement_tx_hash');
    expect(sql).toContain('settlement_type');
    expect(sql).toContain('settled_at');
    expect(params).toEqual(['refunded', 'REFUND_TX_HASH', 'refund', 10]);

    // The buyer's original payment hash is untouched.
    expect(order.stellar_tx_hash).toBe(PAYMENT_TX_HASH);
  });
});

// ── POST /:id/claim ──────────────────────────────────────────────────────────
describe('POST /api/orders/:id/claim — keeps the payment hash', () => {
  const order = {
    id: 10,
    buyer_id: 1,
    farmer_id: 2,
    product_id: 5,
    status: 'delivered',
    total_price: 20,
    is_preorder: 0,
    preorder_delivery_date: null,
    escrow_status: 'funded',
    escrow_balance_id: 'BALANCE_ID_001',
    stellar_tx_hash: PAYMENT_TX_HASH,
  };

  test('writes the claim to settlement_* and never to stellar_tx_hash', async () => {
    stubQueries(order);

    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('CLAIM_TX_HASH');

    const updates = orderUpdates();
    expect(updates).toHaveLength(1);

    const [sql, params] = updates[0];
    expect(sql).not.toContain('stellar_tx_hash');
    expect(sql).toContain('settlement_tx_hash');
    expect(sql).toContain('settlement_type');
    expect(sql).toContain('settled_at');
    expect(params).toEqual(['claimed', 'CLAIM_TX_HASH', 'claim', 10]);

    expect(order.stellar_tx_hash).toBe(PAYMENT_TX_HASH);
  });
});

// ── Migration 042 ────────────────────────────────────────────────────────────
describe('migration 042 — settlement transaction columns', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');

  test('adds the nullable settlement_tx_hash / settlement_type / settled_at columns', () => {
    const sql = read('042_order_settlement_tx.sql');
    expect(sql).toMatch(/ADD COLUMN settlement_tx_hash/);
    expect(sql).toMatch(/ADD COLUMN settlement_type/);
    expect(sql).toMatch(/ADD COLUMN settled_at/);
    expect(sql).toMatch(
      /settlement_type IN \('release', 'claim', 'refund', 'resolve'\)/
    );
  });

  test('documents that historical rows cannot be backfilled and are left as-is', () => {
    const sql = read('042_order_settlement_tx.sql');
    expect(sql).toMatch(/backfill/i);
    expect(sql).toMatch(/cannot be recovered/i);
    expect(sql).toMatch(/left as-is/i);
    // No DML: existing rows are not rewritten.
    expect(sql).not.toMatch(/UPDATE\s+orders/i);
  });

  test('ships a Postgres variant', () => {
    const sql = read('042_order_settlement_tx.postgres.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS settlement_tx_hash/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS settlement_type/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS settled_at/);
  });

  test('ships an undo that drops all three columns', () => {
    const sql = read('042_order_settlement_tx.undo.sql');
    for (const column of ['settlement_tx_hash', 'settlement_type', 'settled_at']) {
      expect(sql).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
  });
});

// ── Source-level guarantees ──────────────────────────────────────────────────
describe('settlement paths never overwrite stellar_tx_hash', () => {
  const orders = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'orders.js'),
    'utf8'
  );

  test('every `UPDATE orders SET escrow_status` writes settlement_* only', () => {
    const statements = orders.match(/UPDATE orders SET escrow_status[^']*/g) || [];
    // refund + claim (claim-preorder reuses the claim helper).
    expect(statements.length).toBeGreaterThanOrEqual(2);
    for (const statement of statements) {
      expect(statement).not.toContain('stellar_tx_hash');
      expect(statement).toContain('settlement_tx_hash');
      expect(statement).toContain('settlement_type');
    }
  });

  test('GET /api/orders returns the raw order columns (incl. both hashes)', () => {
    expect(orders).toMatch(/SELECT o\.\*/);
  });
});

describe('receipt exposes the payment and settlement hashes', () => {
  const receipt = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'orderReceipt.js'),
    'utf8'
  );

  test('selects both hashes', () => {
    expect(receipt).toContain('o.stellar_tx_hash');
    expect(receipt).toContain('o.settlement_tx_hash');
    expect(receipt).toContain('o.settlement_type');
    expect(receipt).toContain('o.settled_at');
  });

  test('renders the settlement transaction alongside the payment one', () => {
    expect(receipt).toMatch(/Settlement \(/);
    expect(receipt).toMatch(/settlementExplorerUrl/);
  });
});
