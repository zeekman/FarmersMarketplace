'use strict';

/**
 * Tests for aggregateProductViews.js
 *
 * Covers:
 *  - targetDate helper
 *  - Successful aggregation (SQLite path)
 *  - Idempotent rerun (same date, same result)
 *  - Empty dataset (no views)
 *  - Late-arriving records (explicit past date)
 *  - Large-volume batching (> BATCH_SIZE products)
 *  - Partial batch failure (one batch throws, others succeed)
 *  - PostgreSQL path (db.isPostgres = true)
 *  - Cron registration via startProductViewsAggJob
 */

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('../../src/db/schema', () => ({
  prepare: jest.fn(),
  transaction: jest.fn(),
  query: jest.fn(),
  isPostgres: false,
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const cron = require('node-cron');
const db = require('../../src/db/schema');
const logger = require('../../src/logger');
const {
  aggregateProductViews,
  startProductViewsAggJob,
  targetDate,
} = require('../../src/jobs/aggregateProductViews');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Set up SQLite-mode mocks.
 * @param {number[]} productIds - product IDs returned by the DISTINCT query
 * @param {object}   opts
 * @param {boolean}  opts.upsertThrows - make the upsert statement throw
 */
function setupSqliteMocks(productIds = [], { upsertThrows = false } = {}) {
  db.isPostgres = false;

  const distinctStmt = { all: jest.fn().mockReturnValue(productIds.map((id) => ({ product_id: id }))) };
  const upsertStmt = {
    run: upsertThrows
      ? jest.fn().mockImplementation(() => { throw new Error('DB write error'); })
      : jest.fn().mockReturnValue({ changes: 1 }),
  };

  db.prepare.mockImplementation((sql) => {
    if (sql.includes('DISTINCT product_id')) return distinctStmt;
    if (sql.includes('INSERT OR REPLACE')) return upsertStmt;
    return { run: jest.fn(), get: jest.fn(), all: jest.fn().mockReturnValue([]) };
  });

  // transaction executes the callback immediately
  db.transaction.mockImplementation((fn) => (...args) => fn(...args));

  return { distinctStmt, upsertStmt };
}

/**
 * Set up PostgreSQL-mode mocks.
 * @param {number[]} productIds
 * @param {object}   opts
 * @param {boolean}  opts.upsertThrows
 */
function setupPostgresMocks(productIds = [], { upsertThrows = false } = {}) {
  db.isPostgres = true;

  db.query.mockImplementation((sql) => {
    if (sql.includes('DISTINCT product_id')) {
      return Promise.resolve({ rows: productIds.map((id) => ({ product_id: id })) });
    }
    if (sql.includes('INSERT INTO product_view_summaries')) {
      if (upsertThrows) return Promise.reject(new Error('PG write error'));
      return Promise.resolve({ rowCount: productIds.length });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  db.isPostgres = false;
});

// ── targetDate ────────────────────────────────────────────────────────────────

describe('targetDate', () => {
  it('returns yesterday in YYYY-MM-DD format', () => {
    const now = new Date('2026-05-28T12:00:00Z');
    expect(targetDate(now)).toBe('2026-05-27');
  });

  it('handles month boundary correctly', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(targetDate(now)).toBe('2026-05-31');
  });

  it('defaults to yesterday when called with no argument', () => {
    const result = targetDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(result).toBe(yesterday.toISOString().slice(0, 10));
  });
});

// ── Empty dataset ─────────────────────────────────────────────────────────────

describe('aggregateProductViews — empty dataset', () => {
  it('returns zero counts and does not write anything (SQLite)', async () => {
    setupSqliteMocks([]);
    const result = await aggregateProductViews('2026-05-27');
    expect(result).toEqual({ date: '2026-05-27', processed: 0, skipped: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns zero counts and does not write anything (PG)', async () => {
    setupPostgresMocks([]);
    const result = await aggregateProductViews('2026-05-27');
    expect(result).toEqual({ date: '2026-05-27', processed: 0, skipped: 0 });
    // Only the DISTINCT query should have been called
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('DISTINCT product_id');
  });
});

// ── Successful aggregation ────────────────────────────────────────────────────

describe('aggregateProductViews — successful aggregation', () => {
  it('processes all products and returns correct counts (SQLite)', async () => {
    const { upsertStmt } = setupSqliteMocks([1, 2, 3]);
    const result = await aggregateProductViews('2026-05-27');

    expect(result).toEqual({ date: '2026-05-27', processed: 3, skipped: 0 });
    // upsert.run called once per product
    expect(upsertStmt.run).toHaveBeenCalledTimes(3);
    expect(upsertStmt.run).toHaveBeenCalledWith('2026-05-27', '2026-05-27', 1);
    expect(upsertStmt.run).toHaveBeenCalledWith('2026-05-27', '2026-05-27', 2);
    expect(upsertStmt.run).toHaveBeenCalledWith('2026-05-27', '2026-05-27', 3);
  });

  it('processes all products and returns correct counts (PG)', async () => {
    setupPostgresMocks([1, 2, 3]);
    const result = await aggregateProductViews('2026-05-27');

    expect(result).toEqual({ date: '2026-05-27', processed: 3, skipped: 0 });
    // One DISTINCT query + one INSERT upsert (all 3 in a single batch)
    expect(db.query).toHaveBeenCalledTimes(2);
    const upsertCall = db.query.mock.calls[1];
    expect(upsertCall[0]).toContain('INSERT INTO product_view_summaries');
    expect(upsertCall[1]).toContain('2026-05-27');
    expect(upsertCall[1]).toContain(1);
    expect(upsertCall[1]).toContain(2);
    expect(upsertCall[1]).toContain(3);
  });

  it('uses the provided date, not yesterday', async () => {
    const { distinctStmt } = setupSqliteMocks([10]);
    await aggregateProductViews('2025-01-15');
    expect(distinctStmt.all).toHaveBeenCalledWith('2025-01-15');
  });

  it('defaults to yesterday when no date is provided', async () => {
    const { distinctStmt } = setupSqliteMocks([]);
    await aggregateProductViews();
    const yesterday = targetDate();
    expect(distinctStmt.all).toHaveBeenCalledWith(yesterday);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('aggregateProductViews — idempotent reruns', () => {
  it('can be called twice for the same date without error (SQLite)', async () => {
    setupSqliteMocks([1, 2]);
    const r1 = await aggregateProductViews('2026-05-27');
    // Reset mocks but keep same product IDs
    jest.clearAllMocks();
    setupSqliteMocks([1, 2]);
    const r2 = await aggregateProductViews('2026-05-27');

    expect(r1).toEqual({ date: '2026-05-27', processed: 2, skipped: 0 });
    expect(r2).toEqual({ date: '2026-05-27', processed: 2, skipped: 0 });
  });

  it('can be called twice for the same date without error (PG)', async () => {
    setupPostgresMocks([1, 2]);
    const r1 = await aggregateProductViews('2026-05-27');
    jest.clearAllMocks();
    setupPostgresMocks([1, 2]);
    const r2 = await aggregateProductViews('2026-05-27');

    expect(r1).toEqual({ date: '2026-05-27', processed: 2, skipped: 0 });
    expect(r2).toEqual({ date: '2026-05-27', processed: 2, skipped: 0 });
  });
});

// ── Late-arriving records ─────────────────────────────────────────────────────

describe('aggregateProductViews — late-arriving records', () => {
  it('accepts an explicit past date and queries only that date (SQLite)', async () => {
    const { distinctStmt, upsertStmt } = setupSqliteMocks([5, 6]);
    const result = await aggregateProductViews('2026-01-01');

    expect(result).toEqual({ date: '2026-01-01', processed: 2, skipped: 0 });
    expect(distinctStmt.all).toHaveBeenCalledWith('2026-01-01');
    expect(upsertStmt.run).toHaveBeenCalledWith('2026-01-01', '2026-01-01', 5);
    expect(upsertStmt.run).toHaveBeenCalledWith('2026-01-01', '2026-01-01', 6);
  });

  it('accepts an explicit past date and queries only that date (PG)', async () => {
    setupPostgresMocks([5, 6]);
    const result = await aggregateProductViews('2026-01-01');

    expect(result).toEqual({ date: '2026-01-01', processed: 2, skipped: 0 });
    const distinctCall = db.query.mock.calls[0];
    expect(distinctCall[1][0]).toBe('2026-01-01');
  });
});

// ── Large-volume batching ─────────────────────────────────────────────────────

describe('aggregateProductViews — large-volume batching', () => {
  it('splits 1200 products into 3 batches of 500/500/200 (SQLite, BATCH_SIZE=500)', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    const { upsertStmt } = setupSqliteMocks(ids);

    const result = await aggregateProductViews('2026-05-27');

    expect(result).toEqual({ date: '2026-05-27', processed: 1200, skipped: 0 });
    expect(upsertStmt.run).toHaveBeenCalledTimes(1200);
    // transaction should have been called 3 times (once per batch)
    expect(db.transaction).toHaveBeenCalledTimes(3);
  });

  it('splits 600 products into 2 PG batches', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    setupPostgresMocks(ids);

    const result = await aggregateProductViews('2026-05-27');

    expect(result).toEqual({ date: '2026-05-27', processed: 600, skipped: 0 });
    // 1 DISTINCT query + 2 INSERT batches
    expect(db.query).toHaveBeenCalledTimes(3);
  });
});

// ── Partial failure handling ──────────────────────────────────────────────────

describe('aggregateProductViews — partial batch failure', () => {
  it('counts failed batch products as skipped and continues (SQLite)', async () => {
    // 600 products → 2 batches; make the second batch throw
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    db.isPostgres = false;

    const distinctStmt = { all: jest.fn().mockReturnValue(ids.map((id) => ({ product_id: id }))) };
    let callCount = 0;
    const upsertStmt = {
      run: jest.fn().mockReturnValue({ changes: 1 }),
    };

    db.prepare.mockImplementation((sql) => {
      if (sql.includes('DISTINCT product_id')) return distinctStmt;
      if (sql.includes('INSERT OR REPLACE')) return upsertStmt;
      return { run: jest.fn(), all: jest.fn().mockReturnValue([]) };
    });

    // First transaction call succeeds, second throws
    db.transaction.mockImplementation((fn) => {
      callCount++;
      if (callCount === 2) {
        return () => { throw new Error('Disk full'); };
      }
      return (...args) => fn(...args);
    });

    const result = await aggregateProductViews('2026-05-27');

    expect(result.processed).toBe(500);
    expect(result.skipped).toBe(100);
    expect(logger.error).toHaveBeenCalledWith(
      '[product-views-agg] Batch failed, skipping',
      expect.objectContaining({ date: '2026-05-27', error: 'Disk full' })
    );
  });

  it('counts failed PG batch as skipped and continues', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    db.isPostgres = true;

    let queryCount = 0;
    db.query.mockImplementation((sql) => {
      if (sql.includes('DISTINCT product_id')) {
        return Promise.resolve({ rows: ids.map((id) => ({ product_id: id })) });
      }
      queryCount++;
      if (queryCount === 2) return Promise.reject(new Error('PG timeout'));
      return Promise.resolve({ rowCount: 500 });
    });

    const result = await aggregateProductViews('2026-05-27');

    expect(result.processed).toBe(500);
    expect(result.skipped).toBe(100);
    expect(logger.error).toHaveBeenCalledWith(
      '[product-views-agg] Batch failed, skipping',
      expect.objectContaining({ error: 'PG timeout' })
    );
  });
});

// ── Logging ───────────────────────────────────────────────────────────────────

describe('aggregateProductViews — logging', () => {
  it('logs start and completion with date and counts', async () => {
    setupSqliteMocks([1, 2]);
    await aggregateProductViews('2026-05-27');

    expect(logger.info).toHaveBeenCalledWith(
      '[product-views-agg] Starting aggregation',
      { date: '2026-05-27' }
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[product-views-agg] Aggregation complete',
      { date: '2026-05-27', processed: 2, skipped: 0 }
    );
  });

  it('logs a specific message when no views exist', async () => {
    setupSqliteMocks([]);
    await aggregateProductViews('2026-05-27');
    expect(logger.info).toHaveBeenCalledWith(
      '[product-views-agg] No views found, nothing to aggregate',
      { date: '2026-05-27' }
    );
  });
});

// ── Cron registration ─────────────────────────────────────────────────────────

describe('startProductViewsAggJob', () => {
  it('registers a cron job at 01:00 UTC', () => {
    startProductViewsAggJob();
    expect(cron.schedule).toHaveBeenCalledWith('0 1 * * *', expect.any(Function));
  });

  it('logs that the job has been scheduled', () => {
    startProductViewsAggJob();
    expect(logger.info).toHaveBeenCalledWith(
      '[product-views-agg] Cron job scheduled (daily at 01:00 UTC)'
    );
  });
});
