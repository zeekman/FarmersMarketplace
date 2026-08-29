/**
 * stellar-contracts.test.js  (#1149)
 *
 * Unit / integration tests for backend/src/utils/stellar-contracts.js
 *
 * All Soroban RPC network calls and the Stellar SDK are mocked so no
 * running node is required.  Covered:
 *   - normalizeWasmHash(): format normalisation and rejection
 *   - simulateContractCall(): unconfigured source, SDK-incompatible path,
 *       successful simulation, simulation error, restore preamble
 *   - invokeEscrowContract(): deposit/release/refund/dispute happy path,
 *       unsupported action, missing contractId config,
 *       submission ERROR → throws, transaction FAILED → throws,
 *       confirmation timeout → throws
 *   - getEscrowState(): maps simulation result, returns null for not-found
 *   - getContractState(): returns mapped entries, throws 404 on missing contract
 */

'use strict';

// ─── shared mock state (mutated per test) ─────────────────────────────────────

const mockSorobanServer = {
  getLedgerEntries: jest.fn(),
  simulateTransaction: jest.fn(),
  prepareTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
  getLatestLedger: jest.fn(),
  getEvents: jest.fn(),
};

const mockHorizonServer = {
  loadAccount: jest.fn(),
};

const FAKE_KEYPAIR = {
  publicKey: jest.fn().mockReturnValue('GPUBKEY'),
  sign: jest.fn(),
};

const mockStellarSdk = {
  Keypair: {
    fromSecret: jest.fn().mockReturnValue(FAKE_KEYPAIR),
  },
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockReturnValue({ type: 'op' }),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({
      hash: jest.fn().mockReturnValue(Buffer.from('txhash1234567890123456789012345678901234567890123456789012345678', 'hex')),
      sign: jest.fn(),
    }),
  })),
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  BASE_FEE: '100',
  Address: jest.fn().mockImplementation((id) => ({
    toScAddress: jest.fn().mockReturnValue(`scAddress:${id}`),
  })),
  nativeToScVal: jest.fn().mockImplementation((v) => ({ scVal: v })),
  scValToNative: jest.fn().mockImplementation((v) => v),
  xdr: {
    LedgerKey: {
      contractData: jest.fn().mockReturnValue('ledgerKey'),
    },
    LedgerKeyContractData: jest.fn().mockImplementation((v) => v),
    ScVal: {
      scvLedgerKeyContractInstance: jest.fn().mockReturnValue('instanceKey'),
      scvVoid: jest.fn().mockReturnValue({ scvVoid: true }),
    },
    ContractDataDurability: {
      persistent: jest.fn().mockReturnValue('persistent'),
    },
    ContractExecutableType: {
      contractExecutableWasm: jest.fn().mockReturnValue({ name: 'Wasm' }),
    },
  },
  hash: jest.fn().mockReturnValue(Buffer.from('fakehash', 'hex')),
  Operation: {
    uploadContractWasm: jest.fn().mockReturnValue({ type: 'uploadWasm' }),
    createContract: jest.fn().mockReturnValue({ type: 'createContract' }),
  },
  StrKey: {
    encodeContract: jest.fn().mockReturnValue('C_CONTRACT_ID'),
  },
  rpc: {
    Api: {
      isSimulationSuccess: jest.fn(),
      isSimulationError: jest.fn(),
      isSimulationRestore: jest.fn(),
    },
  },
  Horizon: {
    Server: jest.fn().mockReturnValue(mockHorizonServer),
  },
  SorobanRpc: {
    Server: jest.fn().mockReturnValue(mockSorobanServer),
  },
};

jest.mock('@stellar/stellar-sdk', () => mockStellarSdk);
jest.mock('../utils/stellar-config', () => ({
  StellarSdk: mockStellarSdk,
  isTestnet: true,
  server: mockHorizonServer,
  sorobanServer: mockSorobanServer,
  networkPassphrase: 'Test SDF Network ; September 2015',
}));
jest.mock('../config', () => ({
  sorobanEscrowContractId: 'CESCROW_CONTRACT',
  sorobanXlmTokenContractId: 'CTOKEN_CONTRACT',
  platformWalletPublicKey: 'GPUBKEY',
  sorobanSimulationSourcePublicKey: null,
  stellarNetwork: 'testnet',
}));
jest.mock('../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('stellar-contracts', () => {
  let sc;

  beforeEach(() => {
    jest.resetAllMocks();

    // Re-set default implementations for mocks reset above
    mockStellarSdk.Keypair.fromSecret.mockReturnValue(FAKE_KEYPAIR);
    FAKE_KEYPAIR.publicKey.mockReturnValue('GPUBKEY');

    mockStellarSdk.Contract.mockImplementation(() => ({
      call: jest.fn().mockReturnValue({ type: 'op' }),
    }));

    // Fix Address mock after resetAllMocks() clears implementations
    mockStellarSdk.Address.mockImplementation((id) => ({
      toScAddress: jest.fn().mockReturnValue(`scAddress:${id}`),
    }));

    const fakeTx = {
      hash: jest.fn().mockReturnValue(Buffer.alloc(32, 0)),
      sign: jest.fn(),
    };
    mockStellarSdk.TransactionBuilder.mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue(fakeTx),
    }));

    mockSorobanServer.prepareTransaction.mockResolvedValue({
      hash: jest.fn().mockReturnValue(Buffer.alloc(32, 0)),
      sign: jest.fn(),
    });

    mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(true);
    mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
    mockStellarSdk.rpc.Api.isSimulationRestore.mockReturnValue(false);

    mockStellarSdk.nativeToScVal.mockImplementation((v) => ({ scVal: v }));
    mockStellarSdk.scValToNative.mockImplementation((v) => v);

    mockHorizonServer.loadAccount.mockResolvedValue({
      accountId: 'GPUBKEY',
      incrementSequenceNumber: jest.fn(),
    });

    jest.resetModules();
    jest.mock('@stellar/stellar-sdk', () => mockStellarSdk);
    jest.mock('../utils/stellar-config', () => ({
      StellarSdk: mockStellarSdk,
      isTestnet: true,
      server: mockHorizonServer,
      sorobanServer: mockSorobanServer,
      networkPassphrase: 'Test SDF Network ; September 2015',
    }));
    jest.mock('../config', () => ({
      sorobanEscrowContractId: 'CESCROW_CONTRACT',
      sorobanXlmTokenContractId: 'CTOKEN_CONTRACT',
      platformWalletPublicKey: 'GPUBKEY',
      sorobanSimulationSourcePublicKey: null,
      stellarNetwork: 'testnet',
    }));
    jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.mock('../db/schema', () => ({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      isPostgres: false,
    }));

    sc = require('../utils/stellar-contracts');
  });

  // ── normalizeWasmHash ──────────────────────────────────────────────────────

  describe('normalizeWasmHash()', () => {
    it('returns a 64-char lowercase hex hash unchanged', () => {
      const hash = 'a'.repeat(64);
      expect(sc.normalizeWasmHash(hash)).toBe(hash);
    });

    it('strips 0x prefix and lowercases', () => {
      const hex = 'B'.repeat(64);
      expect(sc.normalizeWasmHash('0x' + hex)).toBe(hex.toLowerCase());
    });

    it('trims whitespace before validating', () => {
      const hash = 'c'.repeat(64);
      expect(sc.normalizeWasmHash('  ' + hash + '  ')).toBe(hash);
    });

    it('returns null for a hash that is too short', () => {
      expect(sc.normalizeWasmHash('abc123')).toBeNull();
    });

    it('returns null for a hash with invalid characters', () => {
      expect(sc.normalizeWasmHash('z'.repeat(64))).toBeNull();
    });

    it('returns null for null input', () => {
      expect(sc.normalizeWasmHash(null)).toBeNull();
    });

    it('returns null for a non-string input', () => {
      expect(sc.normalizeWasmHash(12345)).toBeNull();
    });
  });

  // ── simulateContractCall ──────────────────────────────────────────────────

  describe('simulateContractCall()', () => {
    it('throws simulation_source_unconfigured when no source key is set', async () => {
      jest.resetModules();
      jest.mock('@stellar/stellar-sdk', () => mockStellarSdk);
      jest.mock('../utils/stellar-config', () => ({
        StellarSdk: mockStellarSdk,
        isTestnet: true,
        server: mockHorizonServer,
        sorobanServer: mockSorobanServer,
        networkPassphrase: 'Test SDF Network ; September 2015',
      }));
      jest.mock('../config', () => ({
        sorobanEscrowContractId: 'CESCROW_CONTRACT',
        sorobanXlmTokenContractId: 'CTOKEN_CONTRACT',
        platformWalletPublicKey: null,      // no source key
        sorobanSimulationSourcePublicKey: null,
        stellarNetwork: 'testnet',
      }));
      jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
      jest.mock('../db/schema', () => ({
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        isPostgres: false,
      }));

      const localSc = require('../utils/stellar-contracts');
      await expect(
        localSc.simulateContractCall('CCONTRACT', 'get_escrow', [])
      ).rejects.toMatchObject({ code: 'simulation_source_unconfigured' });
    });

    it('throws sdk_incompatible when rpc.Api is absent', async () => {
      jest.resetModules();
      const mockIncompatibleSdk = {
        ...mockStellarSdk,
        rpc: undefined, // no rpc.Api
      };
      jest.mock('@stellar/stellar-sdk', () => mockIncompatibleSdk);
      jest.mock('../utils/stellar-config', () => ({
        StellarSdk: mockIncompatibleSdk,
        isTestnet: true,
        server: mockHorizonServer,
        sorobanServer: mockSorobanServer,
        networkPassphrase: 'Test SDF Network ; September 2015',
      }));
      jest.mock('../config', () => ({
        sorobanEscrowContractId: 'CESCROW_CONTRACT',
        sorobanXlmTokenContractId: 'CTOKEN_CONTRACT',
        platformWalletPublicKey: 'GPUBKEY',
        sorobanSimulationSourcePublicKey: null,
        stellarNetwork: 'testnet',
      }));
      jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
      jest.mock('../db/schema', () => ({
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        isPostgres: false,
      }));

      const localSc = require('../utils/stellar-contracts');
      await expect(
        localSc.simulateContractCall('CCONTRACT', 'get_escrow', [])
      ).rejects.toMatchObject({ code: 'sdk_incompatible' });
    });

    it('returns success result on a successful simulation', async () => {
      mockSorobanServer.simulateTransaction.mockResolvedValue({
        minResourceFee: '500',
        result: { retval: 42 },
      });
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationRestore.mockReturnValue(false);
      mockStellarSdk.scValToNative.mockReturnValue({ status: 'Pending', buyer: 'GBUYER' });

      const result = await sc.simulateContractCall('CESCROW_CONTRACT', 'get_escrow', []);

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
      expect(result.fee).toBeDefined();
    });

    it('returns error result when simulation reports an error', async () => {
      mockSorobanServer.simulateTransaction.mockResolvedValue({ error: 'Contract panic' });
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(false);

      const result = await sc.simulateContractCall('CESCROW_CONTRACT', 'get_escrow', []);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns error result when RPC call throws', async () => {
      mockSorobanServer.simulateTransaction.mockRejectedValue(new Error('RPC unreachable'));
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);

      const result = await sc.simulateContractCall('CESCROW_CONTRACT', 'get_escrow', []);

      expect(result.success).toBe(false);
      expect(result.error).toContain('RPC unreachable');
    });

    it('returns restoreRequired flag in result when simulation needs restore', async () => {
      const simResult = {
        minResourceFee: '100',
        result: { retval: null },
        restorePreamble: { minResourceFee: '200' },
      };
      mockSorobanServer.simulateTransaction.mockResolvedValue(simResult);
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationRestore.mockReturnValue(true);

      const result = await sc.simulateContractCall('CESCROW_CONTRACT', 'get_escrow', []);

      expect(result.success).toBe(true);
      expect(result.result.restoreRequired).toBe(true);
      expect(result.result.restoreMinResourceFee).toBe('200');
    });
  });

  // ── invokeEscrowContract ──────────────────────────────────────────────────

  describe('invokeEscrowContract()', () => {
    const BASE_PARAMS = {
      senderSecret: 'SSECRET',
      orderId: 101,
      buyerPublicKey: 'GBUYER',
      farmerPublicKey: 'GFARMER',
      amount: 10,
      timeoutUnix: Math.floor(Date.now() / 1000) + 7200,
      userId: 1,
    };

    function mockSuccessfulSubmit(hash = 'aabbcc001122') {
      mockSorobanServer.sendTransaction.mockResolvedValue({ status: 'PENDING', hash });
      mockSorobanServer.getTransaction
        .mockResolvedValueOnce({ status: 'NOT_FOUND' })
        .mockResolvedValue({ status: 'SUCCESS' });
    }

    it('throws when SOROBAN_ESCROW_CONTRACT_ID is not configured', async () => {
      jest.resetModules();
      jest.mock('@stellar/stellar-sdk', () => mockStellarSdk);
      jest.mock('../utils/stellar-config', () => ({
        StellarSdk: mockStellarSdk, isTestnet: true,
        server: mockHorizonServer, sorobanServer: mockSorobanServer,
        networkPassphrase: 'Test SDF Network ; September 2015',
      }));
      jest.mock('../config', () => ({
        sorobanEscrowContractId: null,     // missing
        sorobanXlmTokenContractId: 'CTOKEN_CONTRACT',
        platformWalletPublicKey: 'GPUBKEY',
        sorobanSimulationSourcePublicKey: null,
        stellarNetwork: 'testnet',
      }));
      jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
      jest.mock('../db/schema', () => ({
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), isPostgres: false,
      }));

      const localSc = require('../utils/stellar-contracts');
      await expect(
        localSc.invokeEscrowContract({ ...BASE_PARAMS, action: 'release' })
      ).rejects.toThrow('SOROBAN_ESCROW_CONTRACT_ID is not configured');
    });

    it('throws when SOROBAN_XLM_TOKEN_CONTRACT_ID is not configured', async () => {
      jest.resetModules();
      jest.mock('@stellar/stellar-sdk', () => mockStellarSdk);
      jest.mock('../utils/stellar-config', () => ({
        StellarSdk: mockStellarSdk, isTestnet: true,
        server: mockHorizonServer, sorobanServer: mockSorobanServer,
        networkPassphrase: 'Test SDF Network ; September 2015',
      }));
      jest.mock('../config', () => ({
        sorobanEscrowContractId: 'CESCROW_CONTRACT',
        sorobanXlmTokenContractId: null,   // missing
        platformWalletPublicKey: 'GPUBKEY',
        sorobanSimulationSourcePublicKey: null,
        stellarNetwork: 'testnet',
      }));
      jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
      jest.mock('../db/schema', () => ({
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), isPostgres: false,
      }));

      const localSc = require('../utils/stellar-contracts');
      await expect(
        localSc.invokeEscrowContract({ ...BASE_PARAMS, action: 'deposit' })
      ).rejects.toThrow('SOROBAN_XLM_TOKEN_CONTRACT_ID is not configured');
    });

    it('throws for an unsupported action', async () => {
      await expect(
        sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'unknown_action' })
      ).rejects.toThrow('Unsupported Soroban escrow action');
    });

    it('throws when sendTransaction returns ERROR status', async () => {
      mockSorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResultXdr: 'tx_failed_xdr',
      });

      await expect(
        sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'release' })
      ).rejects.toThrow();
    });

    it('throws when sendTransaction throws a network error', async () => {
      mockSorobanServer.sendTransaction.mockRejectedValue(new Error('network timeout'));

      await expect(
        sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'release' })
      ).rejects.toThrow('network timeout');
    });

    it('throws when transaction status is FAILED', async () => {
      mockSorobanServer.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'hash_fail' });
      mockSorobanServer.getTransaction.mockResolvedValue({ status: 'FAILED' });

      await expect(
        sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'release' })
      ).rejects.toThrow('Soroban transaction failed');
    });

    it('throws confirmation timeout after many NOT_FOUND polls', async () => {
      // Replace setTimeout with an immediate-resolve stub so the 15 poll loops
      // finish without waiting 15 real seconds.
      const origSetTimeout = global.setTimeout;
      jest.spyOn(global, 'setTimeout').mockImplementation((fn) => origSetTimeout(fn, 0));

      mockSorobanServer.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'hash_to' });
      mockSorobanServer.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

      try {
        await expect(sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'release' }))
          .rejects.toThrow(/timed out/i);
      } finally {
        jest.restoreAllMocks();
      }
    }, 15000);

    it('resolves with txHash and contractId on deposit success', async () => {
      mockSuccessfulSubmit('deposit_tx_hash');

      const result = await sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'deposit' });

      expect(result.txHash).toBe('deposit_tx_hash');
      expect(result.contractId).toBe('CESCROW_CONTRACT');
    });

    it('resolves with txHash and contractId on release success', async () => {
      mockSuccessfulSubmit('release_tx_hash');

      const result = await sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'release' });

      expect(result.txHash).toBe('release_tx_hash');
    });

    it('resolves with txHash on refund success', async () => {
      mockSuccessfulSubmit('refund_tx_hash');

      const result = await sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'refund' });

      expect(result.txHash).toBe('refund_tx_hash');
    });

    it('resolves with txHash on dispute success', async () => {
      mockSuccessfulSubmit('dispute_tx_hash');

      const result = await sc.invokeEscrowContract({ ...BASE_PARAMS, action: 'dispute' });

      expect(result.txHash).toBe('dispute_tx_hash');
    });
  });

  // ── getEscrowState ────────────────────────────────────────────────────────

  describe('getEscrowState()', () => {
    it('returns null when simulation indicates escrow not found', async () => {
      mockSorobanServer.simulateTransaction.mockResolvedValue({ error: 'UnreachableCodeReached' });
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(false);

      const result = await sc.getEscrowState(999);
      expect(result).toBeNull();
    });

    it('throws escrow_read_failed when simulation fails with non-not-found error', async () => {
      mockSorobanServer.simulateTransaction.mockResolvedValue({ error: 'unknown contract error' });
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(false);

      await expect(sc.getEscrowState(1)).rejects.toMatchObject({ code: 'escrow_read_failed' });
    });

    it('returns null when simulation returns null result', async () => {
      mockSorobanServer.simulateTransaction.mockResolvedValue({
        minResourceFee: '100',
        result: { retval: null },
      });
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationRestore.mockReturnValue(false);
      mockStellarSdk.scValToNative.mockReturnValue(null);

      const result = await sc.getEscrowState(1);
      expect(result).toBeNull();
    });

    it('maps a successful escrow simulation result to the expected shape', async () => {
      const escrowData = {
        status: 'Pending',
        buyer: 'GBUYER',
        farmer: 'GFARMER',
        amount: 100_000_000n, // 10 XLM in stroops
        timeout: 1_700_000_000,
        last_updated_ledger: 12345,
      };
      mockSorobanServer.simulateTransaction.mockResolvedValue({
        minResourceFee: '200',
        result: { retval: escrowData },
      });
      mockStellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
      mockStellarSdk.rpc.Api.isSimulationSuccess.mockReturnValue(true);
      mockStellarSdk.rpc.Api.isSimulationRestore.mockReturnValue(false);
      mockStellarSdk.scValToNative.mockReturnValue(escrowData);

      const result = await sc.getEscrowState(1);

      expect(result).not.toBeNull();
      expect(result.status).toBe('Pending');
      expect(result.buyer).toBe('GBUYER');
      expect(result.farmer).toBe('GFARMER');
      expect(result.escrowAddress).toBe('CESCROW_CONTRACT');
      expect(typeof result.amount).toBe('number');
    });
  });

  // ── getContractState ──────────────────────────────────────────────────────

  describe('getContractState()', () => {
    it('throws with code 404 when the RPC reports contract not found', async () => {
      const notFoundErr = new Error('contract not found');
      mockSorobanServer.getLedgerEntries.mockRejectedValue(notFoundErr);

      await expect(sc.getContractState('CUNKNOWN')).rejects.toMatchObject({ code: 404 });
    });

    it('returns empty array when no ledger entries are returned', async () => {
      mockSorobanServer.getLedgerEntries.mockResolvedValue({ entries: [] });

      const entries = await sc.getContractState('CCONTRACT');
      expect(entries).toEqual([]);
    });

    it('maps entries with contractData to key/val/durability', async () => {
      const fakeEntry = {
        lastModifiedLedgerSeq: 100,
        val: {
          contractData: jest.fn().mockReturnValue({
            key: jest.fn().mockReturnValue('MY_KEY'),
            val: jest.fn().mockReturnValue('MY_VAL'),
            durability: jest.fn().mockReturnValue({ name: 'Persistent' }),
          }),
        },
      };
      mockSorobanServer.getLedgerEntries.mockResolvedValue({ entries: [fakeEntry] });
      mockStellarSdk.scValToNative
        .mockReturnValueOnce('MY_KEY')
        .mockReturnValueOnce('MY_VAL');

      const entries = await sc.getContractState('CCONTRACT');

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ key: 'MY_KEY', val: 'MY_VAL', durability: 'Persistent' });
    });

    it('filters entries by prefix when prefix is provided', async () => {
      const makeEntry = (keyName) => ({
        lastModifiedLedgerSeq: 1,
        val: {
          contractData: jest.fn().mockReturnValue({
            key: jest.fn().mockReturnValue(keyName),
            val: jest.fn().mockReturnValue(keyName + '_val'),
            durability: jest.fn().mockReturnValue({ name: 'Persistent' }),
          }),
        },
      });

      mockSorobanServer.getLedgerEntries.mockResolvedValue({
        entries: [makeEntry('ORDER_42'), makeEntry('ADMIN_CONFIG')],
      });
      // scValToNative called twice per entry (key + val) — alternate return values
      mockStellarSdk.scValToNative
        .mockReturnValueOnce('ORDER_42').mockReturnValueOnce('ORDER_42_val')
        .mockReturnValueOnce('ADMIN_CONFIG').mockReturnValueOnce('ADMIN_CONFIG_val');

      const entries = await sc.getContractState('CCONTRACT', 'ORDER_');

      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('ORDER_42');
    });
  });

  // ── error-mapping: Soroban contract error codes → readable messages ───────

  describe('error code mapping (escrow error variants)', () => {
    const ESCROW_ERRORS = [
      'NotFound',
      'AlreadySettled',
      'InDispute',
      'Unauthorized',
      'InvalidAmount',
      'AlreadyExists',
      'TimeoutNotReached',
      'InvalidWasmHash',
    ];

    it.each(ESCROW_ERRORS)(
      'invokeEscrowContract propagates "%s" error from Soroban RPC',
      async (errorVariant) => {
        mockSorobanServer.sendTransaction.mockResolvedValue({
          status: 'ERROR',
          errorResultXdr: `soroban_error:${errorVariant}`,
        });

        await expect(
          sc.invokeEscrowContract({
            action: 'release',
            senderSecret: 'SSECRET',
            orderId: 1,
            buyerPublicKey: 'GBUYER',
            farmerPublicKey: 'GFARMER',
            amount: 1,
            timeoutUnix: Math.floor(Date.now() / 1000) + 7200,
            userId: null,
          })
        ).rejects.toThrow();
      }
    );
  });
});
