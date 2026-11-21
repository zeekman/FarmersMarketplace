'use strict';
const { runTimeoutRefunds, knownContractError, backoffMs } = require('../jobs/timeoutRefunds');

function makeHarness({ orders = [], claim = jest.fn().mockResolvedValue({ txHash: 'tx-refund-1' }), rowCount = 1 } = {}) {
  const database = {
    query: jest.fn(async (sql) => {
      if (sql.includes('SELECT o.id')) return { rows: orders, rowCount: orders.length };
      return { rows: [], rowCount };
    }),
  };
  const notifier = jest.fn().mockResolvedValue();
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { database, client: { claimTimeoutRefund: claim }, notifier, log };
}

describe('timeout escrow refund job', () => {
  it('claims an expired escrow with the platform fee-payer, records hash, and notifies buyer and farmer', async () => {
    const h = makeHarness({ orders: [{ id: 14, buyer_id: 2, farmer_id: 3, timeout_refund_attempts: 0 }] });
    const result = await runTimeoutRefunds({ ...h, signerSecret: 'S_PLATFORM_FEE_PAYER', now: () => 2_000_000_000 });
    expect(h.client.claimTimeoutRefund).toHaveBeenCalledWith({ orderId: 14, signerSecret: 'S_PLATFORM_FEE_PAYER' });
    expect(h.database.query).toHaveBeenCalledWith(
      expect.stringContaining('settlement_tx_hash = $1'),
      ['tx-refund-1', 14]
    );
    expect(h.notifier).toHaveBeenCalledTimes(2);
    expect(h.notifier).toHaveBeenNthCalledWith(1, 2, expect.objectContaining({ txHash: 'tx-refund-1' }));
    expect(h.notifier).toHaveBeenNthCalledWith(2, 3, expect.objectContaining({ txHash: 'tx-refund-1' }));
    expect(result).toMatchObject({ selected: 1, handled: 1, refunded: 1, deferred: 0 });
  });

  it.each([
    ['TimeoutNotReached', 'TimeoutNotReached'],
    ['AlreadySettled', 'AlreadySettled'],
    ['InDispute', 'InDispute'],
  ])('handles %s idempotently and logs it', async (message, expected) => {
    const claim = jest.fn().mockRejectedValue(new Error(message));
    const h = makeHarness({ orders: [{ id: 15, buyer_id: 2, farmer_id: 3, timeout_refund_attempts: 1 }], claim });
    await runTimeoutRefunds({ ...h, signerSecret: 'S_PLATFORM_FEE_PAYER', now: () => 2_000_000_000 });
    expect(h.log.info).toHaveBeenCalledWith(
      expect.stringContaining(expected === 'TimeoutNotReached' ? 'timeout has not elapsed' : 'no longer claimable'),
      expect.objectContaining({ orderId: 15 })
    );
    if (expected !== 'TimeoutNotReached') {
      expect(h.database.query).toHaveBeenCalledWith(expect.stringContaining('SET escrow_status = $1'), [
        expected === 'AlreadySettled' ? 'settled' : 'disputed',
        15,
      ]);
    } else {
      expect(h.database.query).toHaveBeenCalledWith(expect.stringContaining('timeout_refund_retry_at = $2'), expect.any(Array));
    }
  });

  it('schedules other errors using exponential retry backoff', async () => {
    const claim = jest.fn().mockRejectedValue(new Error('RPC unavailable'));
    const h = makeHarness({ orders: [{ id: 16, buyer_id: 2, farmer_id: 3, timeout_refund_attempts: 2 }], claim });
    await runTimeoutRefunds({ ...h, signerSecret: 'S_PLATFORM_FEE_PAYER', now: () => 2_000_000_000, retryBaseMs: 60_000 });
    expect(h.database.query).toHaveBeenCalledWith(
      expect.stringContaining('timeout_refund_attempts = $1'),
      [3, 2_000_000_120, 16]
    );
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('retry scheduled with backoff'),
      expect.objectContaining({ orderId: 16, attempts: 3 })
    );
    expect(backoffMs(3, 60_000, 600_000)).toBe(240_000);
  });

  it('caps the batch size, stops at its runtime boundary, and classifies on-chain numeric variants', async () => {
    const orders = [1, 2, 3].map((id) => ({ id, buyer_id: 2, farmer_id: 3, timeout_refund_attempts: 0 }));
    const claim = jest.fn().mockResolvedValue({ txHash: 'tx' });
    const h = makeHarness({ orders, claim });
    const dates = [0, 0, 10, 10];
    const originalNow = Date.now;
    Date.now = jest.fn(() => dates.shift() ?? 10);
    try {
      const result = await runTimeoutRefunds({
        ...h,
        signerSecret: 'S_PLATFORM_FEE_PAYER',
        batchSize: 500,
        maxRuntimeMs: 5,
        now: () => 2_000_000_000,
      });
      expect(result.handled).toBe(1);
      expect(claim).toHaveBeenCalledTimes(1);
      expect(h.database.query.mock.calls[0][1][1]).toBe(100);
    } finally {
      Date.now = originalNow;
    }
    expect(knownContractError(new Error('Error(Contract, #7)'))).toBe('TimeoutNotReached');
    expect(knownContractError(new Error('Error(Contract, #2)'))).toBe('AlreadySettled');
    expect(knownContractError(new Error('Error(Contract, #3)'))).toBe('InDispute');
  });
});
