/**
 * creatorEarningsMonitor.test.js — Issue #994
 *
 * Tests for the Creator Earnings event indexer:
 *   - credit → creator_earnings_ledger row (event_type = 'credit')
 *   - claim  → creator_earnings_ledger row (event_type = 'claim')
 *   - duplicate events are idempotent (ON CONFLICT DO NOTHING)
 *   - cursor persistence and resume-from-last-ledger
 *   - exponential backoff retry and admin alert on exhaustion
 */

jest.mock('../db/schema');
jest.mock('../utils/stellar');
jest.mock('../utils/mailer', () => ({
  sendContractAlert: jest.fn(),
}));
jest.mock('../logger');
jest.mock('../config', () => ({
  sorobanCreatorEarningsContractId: 'CEARNINGS123',
}));

const CONTRACT_ID = 'CEARNINGS123';

function loadMonitor() {
  jest.resetModules();
  jest.mock('../db/schema');
  jest.mock('../utils/stellar');
  jest.mock('../utils/mailer', () => ({ sendContractAlert: jest.fn() }));
  jest.mock('../logger');
  jest.mock('../config', () => ({ sorobanCreatorEarningsContractId: 'CEARNINGS123' }));
  return require('../jobs/creatorEarningsMonitor');
}

function makeEarningsEvent(action, data, ledger = 100, id = `tx-${action}-${ledger}`) {
  return {
    id,
    topics: ['creator_earnings', action],
    data,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    type: 'contract',
  };
}

// ── credit event ─────────────────────────────────────────────────────────────

describe('credit event → creator_earnings_ledger row', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores a credit row with the farmer/fee split converted to XLM', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _handlers.handleCredit(['GCREATOR1', 9_750_000, 250_000], 'txhash1', 500);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO creator_earnings_ledger'),
      ['GCREATOR1', 0.975, 0.025, 'txhash1', 'credit', 500]
    );
  });

  test('ignores malformed events missing the creator address', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn();

    await _handlers.handleCredit([], 'txhash1', 500);

    expect(dbMod.query).not.toHaveBeenCalled();
  });
});

// ── claim event ──────────────────────────────────────────────────────────────

describe('claim event → creator_earnings_ledger row', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores a claim row with zero fee_amount', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _handlers.handleClaim(['GCREATOR1', 5_000_000], 'txhash2', 501);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO creator_earnings_ledger'),
      ['GCREATOR1', 0.5, 0, 'txhash2', 'claim', 501]
    );
  });
});

// ── dispatchEvent routing ────────────────────────────────────────────────────

describe('dispatchEvent — routes events to correct handler', () => {
  beforeEach(() => jest.clearAllMocks());

  test('credit topic routes to handleCredit', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    const ev = makeEarningsEvent('credit', ['GCREATOR1', 1_000_000, 0], 200);
    await _handlers.dispatchEvent(ev);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining("'credit'"),
      expect.arrayContaining(['GCREATOR1'])
    );
  });

  test('claim topic routes to handleClaim', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    const ev = makeEarningsEvent('claim', ['GCREATOR1', 1_000_000], 201);
    await _handlers.dispatchEvent(ev);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO creator_earnings_ledger'),
      expect.arrayContaining(['claim'])
    );
  });

  test('non-creator_earnings event is ignored (e.g. upgrade or unrelated contract)', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn();

    await _handlers.dispatchEvent({ topics: ['escrow', 'deposit'], data: null, id: 'tx1', ledger: 50 });

    expect(dbMod.query).not.toHaveBeenCalled();
  });

  test('unrecognized creator_earnings action (e.g. upgrade) is not persisted', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn();

    await _handlers.dispatchEvent({ topics: ['creator_earnings', 'upgrade'], data: null, id: 'tx1', ledger: 50 });

    expect(dbMod.query).not.toHaveBeenCalled();
  });
});

// ── idempotency ──────────────────────────────────────────────────────────────

describe('duplicate events are idempotent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('storeEvent uses ON CONFLICT (tx_hash, event_type, ledger_sequence) DO NOTHING', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _handlers.handleCredit(['GCREATOR1', 1_000_000, 0], 'dup-tx', 700);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (tx_hash, event_type, ledger_sequence) DO NOTHING'),
      expect.any(Array)
    );
  });

  test('processing the same event twice issues the same idempotent insert both times', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    const ev = makeEarningsEvent('credit', ['GCREATOR1', 1_000_000, 0], 700, 'dup-tx');
    await _handlers.dispatchEvent(ev);
    await _handlers.dispatchEvent(ev);

    expect(dbMod.query).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = dbMod.query.mock.calls;
    expect(firstCall).toEqual(secondCall);
    // Relies on the DB-level UNIQUE(tx_hash, event_type, ledger_sequence) + ON CONFLICT DO NOTHING
    // to make the second identical insert a no-op.
  });
});

// ── cursor persistence ────────────────────────────────────────────────────────

describe('cursor — persist and resume from last ledger', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getLastLedger returns 0 when no row exists', async () => {
    const { _cursor } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    const ledger = await _cursor.getLastLedger(CONTRACT_ID);
    expect(ledger).toBe(0);
  });

  test('getLastLedger returns stored value', async () => {
    const { _cursor } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [{ last_ledger: 4242 }] });

    const ledger = await _cursor.getLastLedger(CONTRACT_ID);
    expect(ledger).toBe(4242);
  });

  test('saveLastLedger calls upsert with correct args', async () => {
    const { _cursor } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _cursor.saveLastLedger(CONTRACT_ID, 8888);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (contract_id)'),
      [CONTRACT_ID, 8888]
    );
  });

  test('runMonitoringJob resumes from last_ledger + 1', async () => {
    const monitor = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ last_ledger: 3000 }] }) // getLastLedger
      .mockResolvedValue({ rows: [] });

    const stellar = require('../utils/stellar');
    stellar.getContractEvents = jest.fn().mockResolvedValue({ events: [] });

    await monitor.runMonitoringJob();

    expect(stellar.getContractEvents).toHaveBeenCalledWith(
      CONTRACT_ID,
      expect.objectContaining({ fromLedger: 3001 })
    );
  });

  test('runMonitoringJob is a no-op when the contract is not configured', async () => {
    jest.resetModules();
    jest.mock('../db/schema');
    jest.mock('../utils/stellar');
    jest.mock('../utils/mailer', () => ({ sendContractAlert: jest.fn() }));
    jest.mock('../logger');
    jest.mock('../config', () => ({ sorobanCreatorEarningsContractId: null }));
    const monitor = require('../jobs/creatorEarningsMonitor');
    const stellar = require('../utils/stellar');
    stellar.getContractEvents = jest.fn();

    await monitor.runMonitoringJob();

    expect(stellar.getContractEvents).not.toHaveBeenCalled();
  });
});

// ── retry logic ───────────────────────────────────────────────────────────────

describe('retry logic — exponential backoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('retries up to MAX_RETRIES with exponential backoff', async () => {
    const monitor = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    const stellar = require('../utils/stellar');
    let calls = 0;
    stellar.getContractEvents = jest.fn().mockImplementation(() => {
      calls++;
      if (calls <= 3) return Promise.reject(new Error('RPC unavailable'));
      return Promise.resolve({ events: [] });
    });

    const jobPromise = monitor.runMonitoringJob();
    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(Math.min(Math.pow(2, i) * 1000, 60000));
      await Promise.resolve();
    }
    await jobPromise;

    expect(stellar.getContractEvents).toHaveBeenCalledTimes(4);
    const logMod = require('../logger');
    expect(logMod.warn).toHaveBeenCalledTimes(3);
  });

  test('sends admin alert after MAX_RETRIES exhausted', async () => {
    const monitor = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // getLastLedger
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] }); // admin lookup

    const stellar = require('../utils/stellar');
    stellar.getContractEvents = jest.fn().mockRejectedValue(new Error('RPC down'));

    const mailerMod = require('../utils/mailer');
    mailerMod.sendContractAlert = jest.fn().mockResolvedValue();

    const jobPromise = monitor.runMonitoringJob();
    for (let i = 0; i < 6; i++) {
      jest.advanceTimersByTime(Math.min(Math.pow(2, i) * 1000, 60000));
      await Promise.resolve();
    }
    await jobPromise;

    const logMod = require('../logger');
    expect(logMod.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch events'),
      expect.any(String)
    );
    expect(mailerMod.sendContractAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@test.com',
        alert: expect.objectContaining({ alert_type: 'monitor_failure', contract_id: CONTRACT_ID }),
      })
    );
  });
});
