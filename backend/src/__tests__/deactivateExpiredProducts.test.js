'use strict';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('../../src/db/schema', () => ({
  prepare: jest.fn(),
  exec: jest.fn(),
  transaction: jest.fn(),
  query: jest.fn(),
  isPostgres: false,
}));

jest.mock('../../src/utils/mailer', () => ({
  sendProductExpiredEmail: jest.fn(),
  sendOrderEmails: jest.fn(),
  sendLowStockAlert: jest.fn(),
  sendStatusUpdateEmail: jest.fn(),
  sendFreshnessAlert: jest.fn(),
  sendReturnEmail: jest.fn(),
  sendContractAlert: jest.fn(),
  sendBackInStockEmail: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const db = require('../../src/db/schema');
const mailerMock = require('../../src/utils/mailer');
const { deactivateExpiredProducts, todayUTC } = require('../../src/jobs/deactivateExpiredProducts');

// sendProductExpiredEmail is re-assigned in beforeEach because jest.setup.js
// calls jest.resetAllMocks() which clears all mock implementations.
let sendProductExpiredEmail;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProduct(overrides = {}) {
  return {
    id: 1,
    name: 'Tomatoes',
    best_before: '2024-01-01',
    farmer_id: 10,
    farmer_name: 'Alice',
    farmer_email: 'alice@farm.com',
    ...overrides,
  };
}

/**
 * Set up db mocks for SQLite mode (isPostgres=false).
 *
 * In SQLite mode:
 *   - fetchExpiredBatch uses db.prepare().all()
 *   - processProduct uses db.query() for the UPDATE
 *
 * Each call to db.prepare returns the next page of products (first call = products, rest = []).
 */
function setupSqliteMocks(products = [], updateRowCount = 1) {
  let prepareCallCount = 0;
  db.prepare.mockImplementation(() => {
    prepareCallCount++;
    return {
      all: jest.fn().mockReturnValue(prepareCallCount === 1 ? products : []),
    };
  });
  db.query.mockResolvedValue({ rows: [], rowCount: updateRowCount });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.isPostgres = false;
  // After jest.resetAllMocks(), the mock function still exists but its call
  // history is cleared. We just need to point our local variable at it.
  // Do NOT replace mailerMock.sendProductExpiredEmail with a new jest.fn() —
  // the job module captured the original reference at require time.
  sendProductExpiredEmail = mailerMock.sendProductExpiredEmail;
});

describe('todayUTC', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayUTC(new Date('2024-06-15T10:30:00Z'));
    expect(result).toBe('2024-06-15');
  });

  it('uses UTC date, not local time', () => {
    const result = todayUTC(new Date('2024-06-15T00:30:00Z'));
    expect(result).toBe('2024-06-15');
  });

  it('defaults to current date when no argument given', () => {
    const result = todayUTC();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('deactivateExpiredProducts', () => {
  it('returns zero counts when no expired products exist', async () => {
    setupSqliteMocks([]);
    const result = await deactivateExpiredProducts('2024-06-01');
    expect(result).toEqual({ date: '2024-06-01', deactivated: 0, notified: 0, skipped: 0 });
    expect(sendProductExpiredEmail).not.toHaveBeenCalled();
  });

  it('deactivates an expired product and sends notification', async () => {
    const product = makeProduct();
    setupSqliteMocks([product]);

    const result = await deactivateExpiredProducts('2024-06-01');

    expect(result.deactivated).toBe(1);
    expect(result.notified).toBe(1);
    expect(result.skipped).toBe(0);
    expect(sendProductExpiredEmail).toHaveBeenCalledWith({
      product: { id: 1, name: 'Tomatoes', best_before: '2024-01-01' },
      farmer: { name: 'Alice', email: 'alice@farm.com' },
    });
  });

  it('uses the provided date as cutoff', async () => {
    setupSqliteMocks([]);
    const result = await deactivateExpiredProducts('2025-12-31');
    expect(result.date).toBe('2025-12-31');
  });

  it('defaults to todayUTC when no date provided', async () => {
    setupSqliteMocks([]);
    const result = await deactivateExpiredProducts();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe('idempotency', () => {
    it('skips products already processed (UPDATE returns rowCount=0)', async () => {
      const product = makeProduct();
      setupSqliteMocks([product], 0); // UPDATE affects 0 rows → already processed

      await deactivateExpiredProducts('2024-06-01');

      // Email must NOT be sent when UPDATE returns 0 (already processed)
      expect(sendProductExpiredEmail).not.toHaveBeenCalled();
    });

    it('does not send duplicate emails on re-run', async () => {
      const product = makeProduct();

      // First run: UPDATE succeeds
      setupSqliteMocks([product], 1);
      await deactivateExpiredProducts('2024-06-01');
      expect(sendProductExpiredEmail).toHaveBeenCalledTimes(1);

      // Second run: UPDATE returns 0 (already processed)
      jest.clearAllMocks();
      setupSqliteMocks([product], 0);
      await deactivateExpiredProducts('2024-06-01');
      expect(sendProductExpiredEmail).not.toHaveBeenCalled();
    });
  });

  describe('missing farmer email', () => {
    it('deactivates product but skips email when farmer_email is null', async () => {
      const product = makeProduct({ farmer_email: null });
      setupSqliteMocks([product]);

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.deactivated).toBe(1);
      expect(result.notified).toBe(0);
      expect(result.skipped).toBe(0);
      expect(sendProductExpiredEmail).not.toHaveBeenCalled();
    });

    it('deactivates product but skips email when farmer_email is empty string', async () => {
      const product = makeProduct({ farmer_email: '' });
      setupSqliteMocks([product]);

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.notified).toBe(0);
      expect(sendProductExpiredEmail).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('increments skipped when db UPDATE throws', async () => {
      const product = makeProduct();
      let prepareCallCount = 0;
      db.prepare.mockImplementation(() => {
        prepareCallCount++;
        return { all: jest.fn().mockReturnValue(prepareCallCount === 1 ? [product] : []) };
      });
      db.query.mockRejectedValue(new Error('DB error'));

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.skipped).toBe(1);
      expect(result.deactivated).toBe(0);
      expect(sendProductExpiredEmail).not.toHaveBeenCalled();
    });

    it('increments skipped when email sending throws', async () => {
      const product = makeProduct();
      setupSqliteMocks([product], 1);
      sendProductExpiredEmail.mockRejectedValue(new Error('SMTP error'));

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.skipped).toBe(1);
    });

    it('continues processing remaining products after one failure', async () => {
      const p1 = makeProduct({ id: 1 });
      const p2 = makeProduct({ id: 2, name: 'Carrots' });
      let prepareCallCount = 0;
      db.prepare.mockImplementation(() => {
        prepareCallCount++;
        return { all: jest.fn().mockReturnValue(prepareCallCount === 1 ? [p1, p2] : []) };
      });
      let updateCallCount = 0;
      db.query.mockImplementation(async () => {
        updateCallCount++;
        if (updateCallCount === 1) throw new Error('DB error on first');
        return { rows: [], rowCount: 1 };
      });

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.skipped).toBe(1);
      expect(result.deactivated).toBe(1);
    });
  });

  describe('batching', () => {
    it('processes all products in a batch', async () => {
      const products = [makeProduct({ id: 1 }), makeProduct({ id: 2, name: 'Carrots' })];
      let prepareCallCount = 0;
      db.prepare.mockImplementation(() => {
        prepareCallCount++;
        return { all: jest.fn().mockReturnValue(prepareCallCount === 1 ? products : []) };
      });
      db.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.deactivated).toBe(2);
      expect(result.notified).toBe(2);
      expect(sendProductExpiredEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe('timezone handling', () => {
    it('passes the cutoff date to the SQL query', async () => {
      setupSqliteMocks([]);
      await deactivateExpiredProducts('2024-06-15');

      // Verify db.prepare was called with SQL containing the cutoff
      const prepareCall = db.prepare.mock.calls[0];
      expect(prepareCall).toBeDefined();
      // The .all() call should receive the cutoff as first arg
      const allMock = db.prepare.mock.results[0].value.all;
      expect(allMock).toHaveBeenCalledWith('2024-06-15', expect.any(Number), expect.any(Number));
    });

    it('todayUTC returns correct UTC date regardless of local timezone', () => {
      // Midnight UTC on Jan 1 — should be Jan 1, not Dec 31
      expect(todayUTC(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01');
      // Just before midnight UTC — still Dec 31
      expect(todayUTC(new Date('2023-12-31T23:59:59Z'))).toBe('2023-12-31');
    });
  });

  describe('PostgreSQL mode', () => {
    beforeEach(() => {
      db.isPostgres = true;
    });

    afterEach(() => {
      db.isPostgres = false;
    });

    it('deactivates and notifies in postgres mode', async () => {
      const product = makeProduct();
      let queryCallCount = 0;
      db.query.mockImplementation(async (sql) => {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('SELECT')) {
          queryCallCount++;
          return { rows: queryCallCount === 1 ? [product] : [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      });

      const result = await deactivateExpiredProducts('2024-06-01');

      expect(result.deactivated).toBe(1);
      expect(result.notified).toBe(1);
      expect(sendProductExpiredEmail).toHaveBeenCalledTimes(1);
    });

    it('uses $1 placeholders in postgres mode', async () => {
      db.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await deactivateExpiredProducts('2024-06-01');

      const selectCall = db.query.mock.calls.find(([sql]) =>
        sql.trim().toUpperCase().startsWith('SELECT')
      );
      expect(selectCall).toBeDefined();
      expect(selectCall[0]).toContain('$1');
    });
  });
});
