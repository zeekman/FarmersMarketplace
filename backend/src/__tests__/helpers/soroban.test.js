/**
 * helpers/soroban.test.js — Issue #863
 *
 * Unit tests for the Soroban sandbox helper module.
 * All network / Docker calls are mocked — no live node required.
 */

'use strict';

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk BEFORE requiring the module under test
// ---------------------------------------------------------------------------
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');

  const mockSorobanServer = {
    prepareTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
    getLatestLedger: jest.fn(),
  };

  const mockHorizonServer = {
    loadAccount: jest.fn().mockResolvedValue({
      accountId: () => 'GTEST',
      sequenceNumber: () => '1',
      incrementSequenceNumber: jest.fn(),
      sequence: '1',
    }),
  };

  return {
    ...actual,
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockHorizonServer),
    },
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => mockSorobanServer),
    },
  };
});

// Also mock child_process so tests never actually call Docker
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const { execSync, spawnSync } = require('child_process');
const StellarSdk = require('@stellar/stellar-sdk');

function getSorobanMock() {
  return StellarSdk.SorobanRpc.Server.mock.results[0]?.value ||
         new StellarSdk.SorobanRpc.Server();
}

function getHorizonMock() {
  return StellarSdk.Horizon.Server.mock.results[0]?.value ||
         new StellarSdk.Horizon.Server();
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('setupSandbox', () => {
  let setupSandbox, teardownSandbox, _isSandboxRunning;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => {
      const actual = jest.requireActual('@stellar/stellar-sdk');
      const sorobanMock = {
        prepareTransaction: jest.fn(),
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }),
      };
      const horizonMock = {
        loadAccount: jest.fn().mockResolvedValue({ sequence: '1', incrementSequenceNumber: jest.fn() }),
      };
      return {
        ...actual,
        Horizon: { Server: jest.fn().mockImplementation(() => horizonMock) },
        SorobanRpc: { Server: jest.fn().mockImplementation(() => sorobanMock) },
      };
    });
    jest.mock('child_process', () => ({ execSync: jest.fn(), spawnSync: jest.fn() }));
    ({ setupSandbox, teardownSandbox, _isSandboxRunning } = require('./soroban'));
  });

  test('is a no-op when sandbox container is already running', async () => {
    const { execSync: exec, spawnSync: spawn } = require('child_process');
    // Simulate container already running
    exec.mockReturnValue('true\n');

    await setupSandbox();

    // Docker run should NOT have been called
    expect(spawn).not.toHaveBeenCalled();
  });

  test('starts Docker container when sandbox is not running', async () => {
    const { execSync: exec, spawnSync: spawn } = require('child_process');
    // Container not running
    exec.mockReturnValue('false\n');
    // docker run succeeds
    spawn.mockReturnValue({ status: 0, stdout: 'container-id\n', stderr: '' });
    // RPC becomes ready on first poll
    const StellarSdkMod = require('@stellar/stellar-sdk');
    StellarSdkMod.SorobanRpc.Server.mock.results[0]?.value?.getLatestLedger?.mockResolvedValue({ sequence: 1 });

    await setupSandbox({ timeoutMs: 5_000 });

    expect(spawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['run', '--rm', '-d', '--enable-soroban-rpc']),
      expect.any(Object)
    );
  });

  test('throws when docker run fails', async () => {
    const { execSync: exec, spawnSync: spawn } = require('child_process');
    exec.mockReturnValue('false\n');
    spawn.mockReturnValue({ status: 1, stderr: 'Cannot connect to Docker daemon', stdout: '' });

    await expect(setupSandbox()).rejects.toThrow('Failed to start Soroban sandbox');
  });

  test('throws when RPC does not become ready within timeout', async () => {
    const { execSync: exec, spawnSync: spawn } = require('child_process');
    exec.mockReturnValue('false\n');
    spawn.mockReturnValue({ status: 0, stdout: 'cid\n', stderr: '' });

    // getLatestLedger always rejects
    const StellarSdkMod = require('@stellar/stellar-sdk');
    StellarSdkMod.SorobanRpc.Server.mock.instances[0]?.getLatestLedger?.mockRejectedValue(
      new Error('connection refused')
    );

    await expect(setupSandbox({ timeoutMs: 100 })).rejects.toThrow(
      /did not become ready/
    );
  });
});

describe('teardownSandbox', () => {
  test('stops container when it was started by this process', async () => {
    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => {
      const actual = jest.requireActual('@stellar/stellar-sdk');
      const soroban = {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }),
        prepareTransaction: jest.fn(),
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
      };
      const horizon = { loadAccount: jest.fn() };
      return {
        ...actual,
        Horizon: { Server: jest.fn().mockImplementation(() => horizon) },
        SorobanRpc: { Server: jest.fn().mockImplementation(() => soroban) },
      };
    });
    jest.mock('child_process', () => ({ execSync: jest.fn(), spawnSync: jest.fn() }));

    const mod = require('./soroban');
    const { execSync: exec, spawnSync: spawn } = require('child_process');

    // Simulate: container was NOT running, we start it
    exec.mockReturnValue('false\n');
    spawn.mockReturnValue({ status: 0, stdout: 'cid\n', stderr: '' });
    await mod.setupSandbox({ timeoutMs: 2_000 });

    exec.mockReset();
    exec.mockImplementation(() => {}); // docker stop succeeds

    await mod.teardownSandbox();

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('docker stop'),
      expect.any(Object)
    );
  });

  test('is a no-op when sandbox was already running before setupSandbox', async () => {
    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => {
      const actual = jest.requireActual('@stellar/stellar-sdk');
      return {
        ...actual,
        Horizon: { Server: jest.fn().mockImplementation(() => ({ loadAccount: jest.fn() })) },
        SorobanRpc: { Server: jest.fn().mockImplementation(() => ({ getLatestLedger: jest.fn() })) },
      };
    });
    jest.mock('child_process', () => ({ execSync: jest.fn(), spawnSync: jest.fn() }));

    const mod = require('./soroban');
    const { execSync: exec } = require('child_process');

    // Container already running — setupSandbox is a no-op
    exec.mockReturnValue('true\n');
    await mod.setupSandbox();

    exec.mockReset();
    await mod.teardownSandbox();

    // docker stop should NOT be called
    expect(exec).not.toHaveBeenCalledWith(
      expect.stringContaining('docker stop'),
      expect.any(Object)
    );
  });
});

describe('waitForTransaction', () => {
  let waitForTransaction;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => {
      const actual = jest.requireActual('@stellar/stellar-sdk');
      const soroban = {
        getTransaction: jest.fn(),
        getLatestLedger: jest.fn(),
        prepareTransaction: jest.fn(),
        sendTransaction: jest.fn(),
      };
      const horizon = { loadAccount: jest.fn() };
      return {
        ...actual,
        Horizon: { Server: jest.fn().mockImplementation(() => horizon) },
        SorobanRpc: { Server: jest.fn().mockImplementation(() => soroban) },
      };
    });
    jest.mock('child_process', () => ({ execSync: jest.fn(), spawnSync: jest.fn() }));
    ({ waitForTransaction } = require('./soroban'));
  });

  test('resolves when transaction reaches SUCCESS', async () => {
    const StellarSdkMod = require('@stellar/stellar-sdk');
    const soroban = StellarSdkMod.SorobanRpc.Server.mock.results[0]?.value ||
                    StellarSdkMod.SorobanRpc.Server.mock.instances[0];
    soroban.getTransaction = jest.fn()
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'SUCCESS', returnValue: null });

    const result = await waitForTransaction('abc123');
    expect(result.status).toBe('SUCCESS');
  });

  test('throws when transaction FAILED', async () => {
    const StellarSdkMod = require('@stellar/stellar-sdk');
    const soroban = StellarSdkMod.SorobanRpc.Server.mock.results[0]?.value ||
                    StellarSdkMod.SorobanRpc.Server.mock.instances[0];
    soroban.getTransaction = jest.fn().mockResolvedValue({ status: 'FAILED' });

    await expect(waitForTransaction('bad-tx')).rejects.toThrow('bad-tx');
  });

  test('throws after maxAttempts without SUCCESS', async () => {
    const StellarSdkMod = require('@stellar/stellar-sdk');
    const soroban = StellarSdkMod.SorobanRpc.Server.mock.results[0]?.value ||
                    StellarSdkMod.SorobanRpc.Server.mock.instances[0];
    soroban.getTransaction = jest.fn().mockResolvedValue({ status: 'PENDING' });

    await expect(waitForTransaction('stuck-tx', 2)).rejects.toThrow('timed out');
  });
});

describe('deployContract error handling (#474)', () => {
  let deployContract;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => {
      const actual = jest.requireActual('@stellar/stellar-sdk');
      const soroban = {
        prepareTransaction: jest.fn(),
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
        getLatestLedger: jest.fn(),
      };
      const horizon = {
        loadAccount: jest.fn().mockResolvedValue({
          accountId: () => 'GTEST',
          sequenceNumber: () => '1',
          incrementSequenceNumber: jest.fn(),
          sequence: '1',
        }),
      };
      return {
        ...actual,
        Horizon: { Server: jest.fn().mockImplementation(() => horizon) },
        SorobanRpc: { Server: jest.fn().mockImplementation(() => soroban) },
      };
    });
    jest.mock('child_process', () => ({ execSync: jest.fn(), spawnSync: jest.fn() }));
    ({ deployContract } = require('./soroban'));
  });

  test('invalid WASM buffer produces "WASM upload failed" error', async () => {
    const StellarSdkMod = require('@stellar/stellar-sdk');
    const soroban = StellarSdkMod.SorobanRpc.Server.mock.results[0]?.value ||
                    StellarSdkMod.SorobanRpc.Server.mock.instances[0];
    soroban.prepareTransaction = jest.fn().mockRejectedValue(new Error('invalid wasm'));

    const keypair = StellarSdkMod.Keypair.random();
    await expect(deployContract(Buffer.from('not-wasm'), keypair))
      .rejects.toThrow('WASM upload failed: invalid wasm');
  });

  test('contract instantiation failure produces descriptive error', async () => {
    const StellarSdkMod = require('@stellar/stellar-sdk');
    const soroban = StellarSdkMod.SorobanRpc.Server.mock.results[0]?.value ||
                    StellarSdkMod.SorobanRpc.Server.mock.instances[0];

    // WASM upload succeeds
    soroban.prepareTransaction
      .mockResolvedValueOnce({ sign: jest.fn() });
    soroban.sendTransaction
      .mockResolvedValueOnce({ hash: 'upload-hash' });
    soroban.getTransaction
      .mockResolvedValueOnce({ status: 'SUCCESS', returnValue: null });

    // Contract creation fails
    soroban.prepareTransaction
      .mockRejectedValueOnce(new Error('contract already exists'));

    const keypair = StellarSdkMod.Keypair.random();
    await expect(deployContract(Buffer.from([0x00, 0x61, 0x73, 0x6d]), keypair))
      .rejects.toThrow('Contract instantiation failed: contract already exists');
  });
});

describe('fundAccount', () => {
  let fundAccount;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => {
      const actual = jest.requireActual('@stellar/stellar-sdk');
      return {
        ...actual,
        Horizon: { Server: jest.fn().mockImplementation(() => ({ loadAccount: jest.fn() })) },
        SorobanRpc: { Server: jest.fn().mockImplementation(() => ({ getLatestLedger: jest.fn() })) },
      };
    });
    jest.mock('child_process', () => ({ execSync: jest.fn(), spawnSync: jest.fn() }));
    ({ fundAccount } = require('./soroban'));
  });

  test('throws when Friendbot returns non-OK status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(fundAccount('GTEST')).rejects.toThrow('Friendbot failed: 429');
  });

  test('returns parsed JSON on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ account_id: 'GTEST', status: 'funded' }),
    });
    const result = await fundAccount('GTEST');
    expect(result).toEqual({ account_id: 'GTEST', status: 'funded' });
  });
});
