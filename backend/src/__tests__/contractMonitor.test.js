/**
 * contractMonitor.test.js
 * Tests for exponential backoff retry logic
 */

jest.mock('../db/schema');
jest.mock('../utils/stellar');
jest.mock('../utils/mailer');
jest.mock('../logger');

const db = require('../db/schema');
const { getContractEvents } = require('../utils/stellar');
const mailer = require('../utils/mailer');
const logger = require('../logger');

describe('ContractMonitor - Retry Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('should retry on RPC failure with exponential backoff', async () => {
    const { runMonitoringJob } = require('../jobs/contractMonitor');

    // Mock database to return a contract
    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: 'CABC123' }],
    });

    // Mock RPC to fail 3 times, then succeed
    let callCount = 0;
    getContractEvents.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.reject(new Error('RPC temporarily unavailable'));
      }
      return Promise.resolve({ events: [] });
    });

    // Run the job
    const jobPromise = runMonitoringJob();

    // Fast-forward through retries
    // Retry 1: 1s backoff
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    // Retry 2: 2s backoff
    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    // Retry 3: 4s backoff
    jest.advanceTimersByTime(4000);
    await Promise.resolve();

    await jobPromise;

    // Should have retried 3 times before succeeding
    expect(getContractEvents).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  test('should send admin notification after max retries exhausted', async () => {
    const { runMonitoringJob } = require('../jobs/contractMonitor');

    // Mock database
    db.query
      .mockResolvedValueOnce({
        rows: [{ contract_id: 'CABC123' }],
      })
      .mockResolvedValueOnce({
        rows: [{ email: 'admin@test.com' }],
      });

    // Mock RPC to always fail
    getContractEvents.mockRejectedValue(new Error('RPC unavailable'));

    // Mock mailer
    mailer.sendContractAlert.mockResolvedValue({});

    // Run the job
    const jobPromise = runMonitoringJob();

    // Fast-forward through all retries
    for (let i = 0; i < 5; i++) {
      const backoff = Math.min(Math.pow(2, i) * 1000, 5 * 60 * 1000);
      jest.advanceTimersByTime(backoff);
      await Promise.resolve();
    }

    await jobPromise;

    // Should have logged error
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[ContractMonitor] Failed to fetch events'),
      expect.any(String)
    );

    // Should have sent admin notification
    expect(mailer.sendContractAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@test.com',
        alert: expect.objectContaining({
          alert_type: 'monitor_failure',
          contract_id: 'CABC123',
        }),
      })
    );
  });

  test('should cap backoff at 5 minutes', async () => {
    const { runMonitoringJob } = require('../jobs/contractMonitor');

    db.query.mockResolvedValueOnce({
      rows: [{ contract_id: 'CABC123' }],
    });

    // Mock RPC to fail
    getContractEvents.mockRejectedValue(new Error('RPC unavailable'));

    // Mock admin query
    db.query.mockResolvedValueOnce({
      rows: [{ email: 'admin@test.com' }],
    });

    mailer.sendContractAlert.mockResolvedValue({});

    const jobPromise = runMonitoringJob();

    // Advance through retries - the 5th retry should be capped at 5 minutes
    for (let i = 0; i < 5; i++) {
      const backoff = Math.min(Math.pow(2, i) * 1000, 5 * 60 * 1000);
      jest.advanceTimersByTime(backoff);
      await Promise.resolve();
    }

    await jobPromise;

    // Verify the last backoff was capped
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringContaining('retrying in 300000ms'),
      expect.any(String)
    );
  });
});
