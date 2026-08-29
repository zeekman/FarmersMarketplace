/**
 * Unit tests for contractAudit module (issue #1156)
 * Tests contract invocation audit logging
 */

const { recordContractInvocation, ARGS_LIMIT } = require('../jobs/contractAudit');
const db = require('../db/schema');

jest.mock('../db/schema');

describe('recordContractInvocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query = jest.fn().mockResolvedValue({});
  });

  test('records contract invocation with all fields', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: { amount: 100, buyer: 'GBUYER' },
      txHash: 'TX_HASH_123',
      status: 'success',
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO contract_invocations'),
      ['CTEST123', 'deposit', '{"amount":100,"buyer":"GBUYER"}', 'TX_HASH_123', 'success']
    );
  });

  test('defaults status to success', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'release',
      args: {},
      txHash: 'TX_HASH_456',
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['success'])
    );
  });

  test('handles null txHash', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'refund',
      args: {},
      txHash: null,
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([null])
    );
  });

  test('serializes object args to JSON', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: { orderId: 42, amount: 150 },
      txHash: 'TX_HASH',
    });

    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[2]).toBe('{"orderId":42,"amount":150}');
  });

  test('handles string args directly', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: 'already-serialized',
      txHash: 'TX_HASH',
    });

    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[2]).toBe('already-serialized');
  });

  test('handles null args', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: null,
      txHash: 'TX_HASH',
    });

    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[2]).toBeNull();
  });

  test('handles undefined args', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: undefined,
      txHash: 'TX_HASH',
    });

    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[2]).toBeNull();
  });

  test('truncates oversized args', async () => {
    const largeArgs = { data: 'x'.repeat(5000) };

    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: largeArgs,
      txHash: 'TX_HASH',
    });

    const callArgs = db.query.mock.calls[0][1];
    const storedArgs = callArgs[2];

    expect(storedArgs.length).toBe(ARGS_LIMIT);
    expect(storedArgs).not.toContain('"}'); // Truncated, no closing brace
  });

  test('does not truncate args within limit', async () => {
    const normalArgs = { data: 'x'.repeat(100) };
    const serialized = JSON.stringify(normalArgs);

    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: normalArgs,
      txHash: 'TX_HASH',
    });

    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[2]).toBe(serialized);
    expect(callArgs[2].length).toBeLessThan(ARGS_LIMIT);
  });

  test('ARGS_LIMIT is exported and equals 4000', () => {
    expect(ARGS_LIMIT).toBe(4000);
  });

  test('records failure status', async () => {
    await recordContractInvocation({
      contractId: 'CTEST123',
      action: 'deposit',
      args: {},
      txHash: 'TX_HASH',
      status: 'failed',
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['failed'])
    );
  });
});
