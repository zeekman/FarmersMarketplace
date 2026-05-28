'use strict';

/**
 * Tests for processSubscriptions.js
 *
 * Mocks: db/schema, utils/stellar, utils/idempotency, routes/subscriptions, logger
 */

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('../../src/db/schema', () => ({
  prepare: jest.fn(),
  transaction: jest.fn(),
  query: jest.fn(),
  isPostgres: false,
}));

jest.mock('../../src/utils/stellar', () => ({
  sendPayment: jest.fn(),
  createWallet: jest.fn(),
  createWalletFromMnemonic: jest.fn(),
  deriveKeypairFromMnemonic: jest.fn(),
  getBalance: jest.fn(),
  getTransactions: jest.fn(),
  fundTestnetAccount: jest.fn(),
  createClaimableBalance: jest.fn(),
  createPreorderClaimableBalance: jest.fn(),
  claimBalance: jest.fn(),
  simulateContractCall: jest.fn(),
  getContractWasmHash: jest.fn(),
  isTestnet: true,
}));

jest.mock('../../src/routes/subscriptions', () => ({
  nextOrderDate: jest.fn(() => '2099-01-01T00:00:00.000Z'),
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const db = require('../../src/db/schema');
const { sendPayment } = require('../../src/utils/stellar');
const { nextOrderDate } = require('../../src/routes/subscriptions');
const { processSubscriptions } = require('../../src/jobs/processSubscriptions');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSub(overrides = {}) {
  return {
    id: 1,
    buyer_id: 10,
    product_id: 20,
    quantity: 2,
    frequency: 'weekly',
    next_order_at: '2020-01-01T00:00:00.000Z',
    status: 'active',
    retry_count: 0,
    retry_after: null,
    price: 5,
    product_name: 'Apples',
    buyer_wallet: 'GBUYER',
    buyer_secret: 'SBUYER',
    farmer_wallet: 'GFARMER',
    ...overrides,
  };
}

function setupDbMocks({ sub, currentStatus = 'active', currentRetryCount = 0, stockOk = true, idempotencyRows = [] } = {}) {
  const theSub = sub || makeSub();

  // db.query for idempotency check
  db.query.mockResolvedValue({ rows: idempotencyRows, rowCount: idempotencyRows.length });

  // db.prepare chains
  const prepareMap = {};

  // SELECT due subscriptions
  prepareMap.due = { all: jest.fn().mockReturnValue([theSub]) };

  // SELECT current status
  prepareMap.current = {
    get: jest.fn().mockReturnValue({ status: currentStatus, retry_count: currentRetryCount }),
  };

  // Stock update
  prepareMap.stockDecrement = {
    run: jest.fn().mockReturnValue({ changes: stockOk ? 1 : 0 }),
  };

  // INSERT order
  prepareMap.insertOrder = {
    run: jest.fn().mockReturnValue({ lastInsertRowid: 99 }),
  };

  // UPDATE order status
  prepareMap.updateOrder = { run: jest.fn() };

  // UPDATE subscriptions next_order_at
  prepareMap.updateSubSuccess = { run: jest.fn() };

  // UPDATE order failed
  prepareMap.updateOrderFailed = { run: jest.fn() };

  // Stock restore
  prepareMap.stockRestore = { run: jest.fn() };

  // UPDATE subscriptions failed/retry
  prepareMap.updateSubFailed = { run: jest.fn() };
  prepareMap.updateSubRetry = { run: jest.fn() };

  // SELECT idempotency fallback (orders table)
  prepareMap.orderCheck = { get: jest.fn().mockReturnValue(null) };

  db.prepare.mockImplementation((sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('WHERE s.status') && s.includes('next_order_at')) return prepareMap.due;
    if (s.startsWith('SELECT status, retry_count')) return prepareMap.current;
    if (s.startsWith('UPDATE products SET quantity = quantity -')) return prepareMap.stockDecrement;
    if (s.startsWith('INSERT INTO orders')) return prepareMap.insertOrder;
    if (s.startsWith('UPDATE orders SET status = ?, stellar_tx_hash')) return prepareMap.updateOrder;
    if (s.startsWith('UPDATE subscriptions SET next_order_at')) return prepareMap.updateSubSuccess;
    if (s.startsWith('UPDATE orders SET status = ?') && !s.includes('stellar_tx_hash')) return prepareMap.updateOrderFailed;
    if (s.startsWith('UPDATE products SET quantity = quantity +')) return prepareMap.stockRestore;
    if (s.includes("status = 'failed'")) return prepareMap.updateSubFailed;
    if (s.startsWith('UPDATE subscriptions SET retry_count')) return prepareMap.updateSubRetry;
    if (s.startsWith('SELECT id FROM orders')) return prepareMap.orderCheck;
    return { run: jest.fn(), get: jest.fn(), all: jest.fn().mockReturnValue([]) };
  });

  // transaction executes the callback immediately
  db.transaction.mockImplementation((fn) => (...args) => fn(...args));

  return prepareMap;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Restore nextOrderDate after jest.setup.js resetAllMocks
  nextOrderDate.mockReturnValue('2099-01-01T00:00:00.000Z');
});

describe('processSubscriptions', () => {
  it('does nothing when no subscriptions are due', async () => {
    db.prepare.mockReturnValue({ all: jest.fn().mockReturnValue([]) });
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('processes a successful renewal', async () => {
    const maps = setupDbMocks();
    sendPayment.mockResolvedValue('TXHASH_OK');

    await processSubscriptions();

    expect(sendPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        senderSecret: 'SBUYER',
        receiverPublicKey: 'GFARMER',
        amount: 10, // 5 * 2
        memo: 'Sub#1',
      })
    );
    expect(maps.updateOrder.run).toHaveBeenCalledWith('paid', 'TXHASH_OK', 99);
    expect(maps.updateSubSuccess.run).toHaveBeenCalledWith('2099-01-01T00:00:00.000Z', 1);
  });

  it('skips subscriptions that are not active', async () => {
    setupDbMocks({ currentStatus: 'paused' });
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('skips cancelled subscriptions', async () => {
    setupDbMocks({ currentStatus: 'cancelled' });
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('skips already-processed subscriptions (idempotency key found)', async () => {
    setupDbMocks({ idempotencyRows: [{ id: 'existing-key' }] });
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('skips when paid order already exists (fallback idempotency)', async () => {
    // db.query throws (no idempotency_keys table), fallback to orders check
    const maps = setupDbMocks();
    db.query.mockRejectedValue(new Error('no such table'));
    maps.orderCheck.get.mockReturnValue({ id: 55 }); // paid order found
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('skips when stock is insufficient', async () => {
    setupDbMocks({ stockOk: false });
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('schedules retry on transient payment failure', async () => {
    const maps = setupDbMocks();
    const transientErr = new Error('Network timeout');
    sendPayment.mockRejectedValue(transientErr);

    await processSubscriptions();

    expect(maps.updateOrderFailed.run).toHaveBeenCalledWith('failed', 99);
    expect(maps.stockRestore.run).toHaveBeenCalledWith(2, 20);
    expect(maps.updateSubRetry.run).toHaveBeenCalledWith(1, expect.any(String), 1);
    expect(maps.updateSubFailed.run).not.toHaveBeenCalled();
  });

  it('marks subscription as failed on permanent error: account_not_found', async () => {
    const maps = setupDbMocks();
    const permErr = new Error('Account not found');
    permErr.code = 'account_not_found';
    sendPayment.mockRejectedValue(permErr);

    await processSubscriptions();

    expect(maps.updateSubFailed.run).toHaveBeenCalledWith(1, 1);
    expect(maps.updateSubRetry.run).not.toHaveBeenCalled();
  });

  it('marks subscription as failed on permanent error: insufficient balance message', async () => {
    const maps = setupDbMocks();
    const permErr = new Error('insufficient balance to pay fees');
    sendPayment.mockRejectedValue(permErr);

    await processSubscriptions();

    expect(maps.updateSubFailed.run).toHaveBeenCalledWith(1, 1);
  });

  it('marks subscription as failed when retry count is exhausted', async () => {
    const maps = setupDbMocks({ currentRetryCount: 3 }); // MAX_RETRIES=3, so 3+1 > 3
    const transientErr = new Error('Network timeout');
    sendPayment.mockRejectedValue(transientErr);

    await processSubscriptions();

    expect(maps.updateSubFailed.run).toHaveBeenCalledWith(4, 1);
    expect(maps.updateSubRetry.run).not.toHaveBeenCalled();
  });

  it('does not double-charge on duplicate execution (second run skips via idempotency)', async () => {
    // First run succeeds
    const maps = setupDbMocks();
    sendPayment.mockResolvedValue('TXHASH_OK');
    await processSubscriptions();
    expect(sendPayment).toHaveBeenCalledTimes(1);

    // Second run: idempotency key now present
    jest.clearAllMocks();
    setupDbMocks({ idempotencyRows: [{ id: 'key' }] });
    await processSubscriptions();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('resets retry_count to 0 after successful payment', async () => {
    const maps = setupDbMocks({ currentRetryCount: 2 });
    sendPayment.mockResolvedValue('TXHASH_OK');

    await processSubscriptions();

    expect(maps.updateSubSuccess.run).toHaveBeenCalledWith('2099-01-01T00:00:00.000Z', 1);
  });

  it('does not expose buyer_secret in logs', async () => {
    const logger = require('../../src/logger');
    setupDbMocks();
    const permErr = new Error('account_not_found');
    permErr.code = 'account_not_found';
    sendPayment.mockRejectedValue(permErr);

    await processSubscriptions();

    const allLogCalls = [
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ].flat();

    const logStr = JSON.stringify(allLogCalls);
    expect(logStr).not.toContain('SBUYER');
  });
});
