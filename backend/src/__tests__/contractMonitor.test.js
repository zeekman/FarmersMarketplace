/**
 * contractMonitor.test.js — Issue #862
 *
 * Tests for the escrow event indexer:
 *   - deposit  → escrow_status = 'active'
 *   - release  → escrow_status = 'released', status = 'paid', buyer notified
 *   - refund   → escrow_status = 'refunded', buyer notified
 *   - dispute  → escrow_status = 'disputed'
 *   - cursor persistence and resume-from-last-ledger
 *   - exponential backoff retry and admin alert on exhaustion
 */

jest.mock('../db/schema');
jest.mock('../utils/stellar');
jest.mock('../utils/mailer', () => ({
  sendStatusUpdateEmail: jest.fn(),
  sendContractAlert: jest.fn(),
  sendLowStockAlert: jest.fn(),
  sendOrderEmails: jest.fn(),
}));
jest.mock('../utils/pushNotifications', () => ({
  sendPushToUser: jest.fn(),
}));
jest.mock('../logger');
jest.mock('../config', () => ({
  sorobanEscrowContractId: 'CESCROW123',
}));

const db = require('../db/schema');
const { getContractEvents } = require('../utils/stellar');
const mailer = require('../utils/mailer');
const { sendPushToUser } = require('../utils/pushNotifications');
const logger = require('../logger');

// Fresh require each test group to reset module state
function loadMonitor() {
  jest.resetModules();
  // Re-apply mocks after reset
  jest.mock('../db/schema');
  jest.mock('../utils/stellar');
  jest.mock('../utils/mailer', () => ({
    sendStatusUpdateEmail: jest.fn(),
    sendContractAlert: jest.fn(),
    sendLowStockAlert: jest.fn(),
    sendOrderEmails: jest.fn(),
  }));
  jest.mock('../utils/pushNotifications', () => ({ sendPushToUser: jest.fn() }));
  jest.mock('../logger');
  jest.mock('../config', () => ({ sorobanEscrowContractId: 'CESCROW123' }));
  return require('../jobs/contractMonitor');
}

const CONTRACT_ID = 'CESCROW123';

// Helper: build a mock escrow event
function makeEscrowEvent(action, orderId, data, ledger = 100) {
  return {
    id: `tx-${action}-${orderId}`,
    topics: ['escrow', action, orderId],
    data,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    type: 'contract',
  };
}

// ── deposit event ──────────────────────────────────────────────────────────────

describe('deposit event → escrow_status = active', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets escrow_status to active for the matching order_id', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _handlers.handleDeposit(CONTRACT_ID, ['escrow', 'deposit', 1001], null, 'txhash1');

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining("escrow_status = 'active'"),
      [1001]
    );
  });

  test('ignores event when order_id is missing from topics', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn();

    await _handlers.handleDeposit(CONTRACT_ID, ['escrow', 'deposit'], null, null);

    expect(dbMod.query).not.toHaveBeenCalled();
  });
});

// ── release event ──────────────────────────────────────────────────────────────

describe('release event → escrow_status = released, status = paid, buyer notified', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates escrow_status and order status to paid', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })  // UPDATE orders
      .mockResolvedValueOnce({ rows: [{ id: 2001, total_price: 10, email: 'buyer@test.com', name: 'Buyer', buyer_id: 5, product_name: 'Apples' }] }) // SELECT for notify
      .mockResolvedValueOnce({ rows: [] }); // storeInvocation

    const mailerMod = require('../utils/mailer');
    mailerMod.sendStatusUpdateEmail = jest.fn().mockResolvedValue();
    const pushMod = require('../utils/pushNotifications');
    pushMod.sendPushToUser = jest.fn().mockResolvedValue();

    await _handlers.handleRelease(CONTRACT_ID, ['escrow', 'release', 2001], [9750000, 250000], 'txhash2');

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining("escrow_status = 'released'"),
      [2001]
    );
    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'paid'"),
      [2001]
    );
  });

  test('sends buyer email and push notification on release', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 2001, total_price: 10, email: 'buyer@test.com', name: 'Buyer', buyer_id: 5, product_name: 'Apples' }] })
      .mockResolvedValueOnce({ rows: [] });

    const mailerMod = require('../utils/mailer');
    mailerMod.sendStatusUpdateEmail = jest.fn().mockResolvedValue();
    const pushMod = require('../utils/pushNotifications');
    pushMod.sendPushToUser = jest.fn().mockResolvedValue();

    await _handlers.handleRelease(CONTRACT_ID, ['escrow', 'release', 2001], null, 'txhash2');

    expect(mailerMod.sendStatusUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'paid', recipientEmail: 'buyer@test.com' })
    );
    expect(pushMod.sendPushToUser).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ title: 'Payment Released' })
    );
  });

  test('skips notification gracefully when order not found in DB', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // SELECT — no row

    const mailerMod = require('../utils/mailer');
    mailerMod.sendStatusUpdateEmail = jest.fn();

    await expect(
      _handlers.handleRelease(CONTRACT_ID, ['escrow', 'release', 9999], null, null)
    ).resolves.not.toThrow();

    expect(mailerMod.sendStatusUpdateEmail).not.toHaveBeenCalled();
  });
});

// ── refund event ───────────────────────────────────────────────────────────────

describe('refund event → escrow_status = refunded, buyer notified', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets escrow_status to refunded', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await _handlers.handleRefund(CONTRACT_ID, ['escrow', 'refund', 3001], 5000000, 'txhash3');

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining("escrow_status = 'refunded'"),
      [3001]
    );
  });

  test('sends buyer notification on refund', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 3001, total_price: 10, email: 'b@test.com', name: 'B', buyer_id: 7 }] })
      .mockResolvedValueOnce({ rows: [] });

    const mailerMod = require('../utils/mailer');
    mailerMod.sendStatusUpdateEmail = jest.fn().mockResolvedValue();
    const pushMod = require('../utils/pushNotifications');
    pushMod.sendPushToUser = jest.fn().mockResolvedValue();

    await _handlers.handleRefund(CONTRACT_ID, ['escrow', 'refund', 3001], 5000000, 'txhash3');

    expect(mailerMod.sendStatusUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'refunded', recipientEmail: 'b@test.com' })
    );
    expect(pushMod.sendPushToUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ title: 'Escrow Refunded' })
    );
  });
});

// ── dispute event ──────────────────────────────────────────────────────────────

describe('dispute event → escrow_status = disputed', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets escrow_status to disputed', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _handlers.handleDispute(CONTRACT_ID, ['escrow', 'dispute', 4001], 'GBUYER1', 'txhash4');

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining("escrow_status = 'disputed'"),
      [4001]
    );
  });
});

// ── dispatchEvent routing ─────────────────────────────────────────────────────

describe('dispatchEvent — routes events to correct handler', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['deposit', 1001, "escrow_status = 'active'"],
    ['release', 2001, "escrow_status = 'released'"],
    ['refund',  3001, "escrow_status = 'refunded'"],
    ['dispute', 4001, "escrow_status = 'disputed'"],
  ])('%s event updates escrow_status to correct value', async (action, orderId, expectedSql) => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    // Return empty rows for all queries (incl. notification lookups)
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });
    const mailerMod = require('../utils/mailer');
    mailerMod.sendStatusUpdateEmail = jest.fn().mockResolvedValue();

    const ev = makeEscrowEvent(action, orderId, null, 200);
    await _handlers.dispatchEvent(CONTRACT_ID, ev);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining(expectedSql),
      [orderId]
    );
  });

  test('non-escrow event is stored but does not update orders', async () => {
    const { _handlers } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    const ev = { topics: ['reward_token_set'], data: 'GADDR', id: 'tx1', ledger: 50 };
    await _handlers.dispatchEvent(CONTRACT_ID, ev);

    // storeInvocation should NOT have been called with any escrow_status SQL
    const updateCalls = dbMod.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('escrow_status')
    );
    expect(updateCalls).toHaveLength(0);
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
    dbMod.query = jest.fn().mockResolvedValue({ rows: [{ last_ledger: 12345 }] });

    const ledger = await _cursor.getLastLedger(CONTRACT_ID);
    expect(ledger).toBe(12345);
  });

  test('saveLastLedger calls upsert with correct args', async () => {
    const { _cursor } = loadMonitor();
    const dbMod = require('../db/schema');
    dbMod.query = jest.fn().mockResolvedValue({ rows: [] });

    await _cursor.saveLastLedger(CONTRACT_ID, 99999);

    expect(dbMod.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (contract_id)'),
      [CONTRACT_ID, 99999]
    );
  });

  test('runMonitoringJob resumes from last_ledger + 1', async () => {
    const monitor = loadMonitor();
    const dbMod = require('../db/schema');

    dbMod.query = jest
      .fn()
      // contracts_registry query
      .mockResolvedValueOnce({ rows: [{ contract_id: CONTRACT_ID }] })
      // getLastLedger cursor
      .mockResolvedValueOnce({ rows: [{ last_ledger: 5000 }] })
      // saveLastLedger (if events returned)
      .mockResolvedValue({ rows: [] });

    const stellar = require('../utils/stellar');
    stellar.getContractEvents = jest.fn().mockResolvedValue({ events: [] });

    await monitor.runMonitoringJob();

    // getContractEvents should have been called with fromLedger: 5001
    expect(stellar.getContractEvents).toHaveBeenCalledWith(
      CONTRACT_ID,
      expect.objectContaining({ fromLedger: 5001 })
    );
  });

  test('cursor is updated to highest ledger seen in batch', async () => {
    const monitor = loadMonitor();
    const dbMod = require('../db/schema');

    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ contract_id: CONTRACT_ID }] }) // contracts_registry
      .mockResolvedValueOnce({ rows: [{ last_ledger: 100 }] })          // getLastLedger
      .mockResolvedValue({ rows: [] });                                  // all subsequent

    const stellar = require('../utils/stellar');
    stellar.getContractEvents = jest.fn().mockResolvedValue({
      events: [
        makeEscrowEvent('deposit', 1, null, 110),
        makeEscrowEvent('release', 2, null, 115),
      ],
    });

    await monitor.runMonitoringJob();

    // saveLastLedger called with 115 (highest ledger in batch)
    const upsertCall = dbMod.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('ON CONFLICT (contract_id)')
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall[1]).toEqual([CONTRACT_ID, 115]);
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
    dbMod.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ contract_id: CONTRACT_ID }] })
      .mockResolvedValue({ rows: [] });

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
      .mockResolvedValueOnce({ rows: [{ contract_id: CONTRACT_ID }] })
      .mockResolvedValueOnce({ rows: [] })  // getLastLedger
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

// ── legacy event topic structure tests (kept from #844) ───────────────────────

describe('Escrow event topic structure (#844)', () => {
  const makeEvent = (topics, data) => ({ topics, data, ledger: 100, type: 'contract' });

  test('deposit event topic structure', () => {
    const ev = makeEvent(['escrow', 'deposit', 1], ['BUYER', 'FARMER', 5000000, 1700000000]);
    expect(ev.topics[0]).toBe('escrow');
    expect(ev.topics[1]).toBe('deposit');
    expect(typeof ev.topics[2]).toBe('number');
  });

  test('release event topic structure', () => {
    const ev = makeEvent(['escrow', 'release', 1], [4750000, 250000]);
    expect(ev.topics[1]).toBe('release');
    const [farmer_amount, fee] = ev.data;
    expect(farmer_amount).toBe(4750000);
    expect(fee).toBe(250000);
  });

  test('refund event topic structure', () => {
    const ev = makeEvent(['escrow', 'refund', 1], [5000000]);
    expect(ev.topics[1]).toBe('refund');
    expect(ev.data[0]).toBe(5000000);
  });

  test('dispute event topic structure', () => {
    const ev = makeEvent(['escrow', 'dispute', 1], 'GBUYER');
    expect(ev.topics[1]).toBe('dispute');
    expect(typeof ev.topics[2]).toBe('number');
  });
});
