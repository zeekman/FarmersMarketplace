/**
 * Unit tests for the soroban.js helper.
 * These tests mock the Soroban RPC server and verify error handling (#474).
 */

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: jest.fn().mockResolvedValue({
          accountId: () => 'GTEST',
          sequenceNumber: () => '1',
          incrementSequenceNumber: jest.fn(),
          sequence: '1',
        }),
      })),
    },
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({})),
    },
  };
});

describe('deployContract error handling (#474)', () => {
  let sorobanServerMock;
  let deployContract;

  beforeEach(() => {
    jest.resetModules();

    // Re-require after resetting so we can inject a fresh mock
    const StellarSdk = require('@stellar/stellar-sdk');

    sorobanServerMock = {
      prepareTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      getTransaction: jest.fn(),
    };
    StellarSdk.SorobanRpc.Server.mockImplementation(() => sorobanServerMock);

    ({ deployContract } = require('./soroban'));
  });

  test('invalid WASM buffer produces a descriptive "WASM upload failed" error', async () => {
    sorobanServerMock.prepareTransaction.mockRejectedValue(new Error('invalid wasm'));

    const keypair = require('@stellar/stellar-sdk').Keypair.random();
    const invalidWasm = Buffer.from('not-wasm');

    await expect(deployContract(invalidWasm, keypair)).rejects.toThrow(
      'WASM upload failed: invalid wasm'
    );
  });

  test('contract instantiation failure produces a descriptive error', async () => {
    // WASM upload succeeds
    sorobanServerMock.prepareTransaction
      .mockResolvedValueOnce({ sign: jest.fn() });
    sorobanServerMock.sendTransaction
      .mockResolvedValueOnce({ hash: 'abc123' });
    sorobanServerMock.getTransaction
      .mockResolvedValueOnce({ status: 'SUCCESS', returnValue: null });

    // Contract creation fails
    sorobanServerMock.prepareTransaction
      .mockRejectedValueOnce(new Error('contract already exists'));

    const keypair = require('@stellar/stellar-sdk').Keypair.random();
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d]); // minimal WASM magic

    await expect(deployContract(wasm, keypair)).rejects.toThrow(
      'Contract instantiation failed: contract already exists'
    );
  });
});
