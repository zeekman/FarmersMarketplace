'use strict';
/**
 * Issue #1018 — contractRegistrySync retry/backoff policy tests.
 *
 * Verifies that:
 * - fetchDeployments retries with exponential backoff when Horizon is unreachable
 * - After MAX_RETRIES failures fetchDeployments re-throws (does not swallow)
 * - runSync catches the error from fetchDeployments, logs it, and returns early
 *   without crashing the process (zero insertions)
 * - startRegistrySync does not propagate a startup failure to the caller
 */

jest.mock('../src/db/schema');
jest.mock('../src/utils/stellar-config', () => ({
  server: { operations: jest.fn() },
  isTestnet: true,
}));
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const db = require('../src/db/schema');
const stellarConfig = require('../src/utils/stellar-config');
const logger = require('../src/logger');
const { runSync, fetchDeployments, startRegistrySync } = require('../src/jobs/contractRegistrySync');

// ── helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal Horizon operations() builder that throws on .call() */
function makeFailingHorizonBuilder(error) {
  const builder = {
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockRejectedValue(error),
  };
  stellarConfig.server.operations.mockReturnValue(builder);
  return builder;
}

/** Build a Horizon builder that returns empty records (success, no deployments) */
function makeEmptyHorizonBuilder() {
  const builder = {
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [] }),
  };
  stellarConfig.server.operations.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  db.query = jest.fn();
  db.isPostgres = true;

  // Default: sync_meta returns 0 (first run)
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── fetchDeployments ───────────────────────────────────────────────────────────

describe('fetchDeployments — retry and backoff', () => {
  it('retries up to MAX_RETRIES (3) times before throwing', async () => {
    const rpcError = new Error('ECONNREFUSED: Soroban RPC unreachable');
    makeFailingHorizonBuilder(rpcError);

    const promise = fetchDeployments(0);
    // Advance timers through all backoff delays (5s, 10s, 20s)
    for (let i = 0; i < 3; i++) {
      await Promise.resolve(); // flush microtask
      jest.runAllTimers();
    }
    await expect(promise).rejects.toThrow('ECONNREFUSED');
    expect(stellarConfig.server.operations).toHaveBeenCalledTimes(4); // 1 + 3 retries
  }, 10000);

  it('logs a warning for each retry attempt', async () => {
    const rpcError = new Error('timeout');
    makeFailingHorizonBuilder(rpcError);

    const promise = fetchDeployments(0);
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }
    await promise.catch(() => {});
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      '[contractRegistrySync] Horizon API error, retrying',
      expect.objectContaining({ error: 'timeout', retryCount: expect.any(Number) })
    );
  }, 10000);

  it('succeeds on the second attempt without throwing', async () => {
    const rpcError = new Error('transient');
    // First call fails, second succeeds
    const builder = {
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn()
        .mockRejectedValueOnce(rpcError)
        .mockResolvedValue({ records: [] }),
    };
    stellarConfig.server.operations.mockReturnValue(builder);

    const promise = fetchDeployments(0);
    await Promise.resolve();
    jest.runAllTimers();
    const result = await promise;
    expect(result).toEqual([]);
    expect(builder.call).toHaveBeenCalledTimes(2);
  }, 10000);
});

// ── runSync ────────────────────────────────────────────────────────────────────

describe('runSync — graceful failure on unreachable Horizon', () => {
  it('returns zero insertions and does not throw when Horizon is unreachable at startup', async () => {
    const rpcError = new Error('ECONNREFUSED');
    makeFailingHorizonBuilder(rpcError);

    const promise = runSync();
    // Advance through retries
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }

    const result = await promise;
    expect(result).toMatchObject({ inserted: 0, skipped: 0 });
    expect(logger.error).toHaveBeenCalledWith(
      '[contractRegistrySync] Failed to fetch deployments from Horizon',
      expect.objectContaining({ error: expect.stringContaining('ECONNREFUSED') })
    );
  }, 10000);

  it('does not crash the process (does not reject) on Horizon failure', async () => {
    makeFailingHorizonBuilder(new Error('socket hang up'));

    const promise = runSync();
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }

    await expect(promise).resolves.not.toThrow();
  }, 10000);
});

// ── startRegistrySync ──────────────────────────────────────────────────────────

describe('startRegistrySync — startup failure is non-fatal', () => {
  it('does not propagate a startup sync failure to the caller', async () => {
    makeFailingHorizonBuilder(new Error('RPC down at startup'));

    let interval;
    expect(() => {
      interval = startRegistrySync();
    }).not.toThrow();

    // Advance through all retries
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }

    clearInterval(interval);
    // startRegistrySync itself should not have thrown
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[contractRegistrySync] Starting'),
      expect.anything()
    );
  }, 10000);
});
