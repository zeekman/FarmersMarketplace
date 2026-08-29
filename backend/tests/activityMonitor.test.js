jest.mock('../src/db/schema', () => ({ query: jest.fn() }));
jest.mock('../src/utils/stellar', () => ({ server: { payments: jest.fn(), transactions: jest.fn() } }));
jest.mock('../src/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const db = require('../src/db/schema');
const { server } = require('../src/utils/stellar');
const logger = require('../src/logger');
const { runWithConcurrency, checkUser } = require('../src/jobs/activityMonitor');

describe('activityMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('limits concurrent user workers', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    await runWithConcurrency(
      items,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      },
      3
    );

    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('logs Horizon rate limits separately from expected account errors', async () => {
    const call = jest.fn().mockRejectedValue({
      status: 429,
      message: 'Too many requests',
      response: { headers: { 'retry-after': '10' } },
    });
    server.payments.mockReturnValue({
      forAccount: () => ({ order: () => ({ limit: () => ({ call }) }) }),
    });

    await checkUser(4, 'GABC');

    expect(logger.warn).toHaveBeenCalledWith(
      '[activityMonitor] Horizon rate limit reached',
      expect.objectContaining({ userId: 4, publicKey: 'GABC', retryAfter: '10' })
    );
  });
});
