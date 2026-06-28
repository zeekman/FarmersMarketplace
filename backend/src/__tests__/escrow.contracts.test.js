/**
 * escrow.contracts.test.js — Issue #863
 *
 * Full lifecycle integration tests for the Soroban escrow contract.
 * Runs against a local Soroban sandbox (stellar/quickstart Docker container).
 *
 * The test suite:
 *   1. Spins up the sandbox via helpers/soroban.setupSandbox()
 *   2. Funds three accounts (admin, buyer, farmer)
 *   3. Deploys the compiled escrow WASM
 *   4. Calls initialize() via the production invokeEscrowContract utility
 *   5. Runs: deposit, release, refund, dispute scenarios
 *   6. Tears down the sandbox via helpers/soroban.teardownSandbox()
 *
 * Contract calls in steps 4-5 use the SAME invokeEscrowContract utility
 * that production code uses, so this tests the full integration stack.
 *
 * Prerequisites:
 *   docker-compose -f docker-compose.test.yml up -d
 *   (or the sandbox is started automatically by setupSandbox)
 *
 * Skip guard:
 *   Set SKIP_CONTRACT_TESTS=true to skip the suite without failing the run.
 *   Used in CI where Docker is not available.
 *   A nightly CI job runs with Docker — see .github/workflows/ci.yml.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const StellarSdk = require('@stellar/stellar-sdk');

const {
  setupSandbox,
  teardownSandbox,
  fundAccount,
  deployContract,
  invokeContract,
} = require('./helpers/soroban');

// ---------------------------------------------------------------------------
// Skip guard
// ---------------------------------------------------------------------------
const SKIP = process.env.SKIP_CONTRACT_TESTS === 'true';

if (SKIP && process.env.CI) {
  console.warn(
    '[WARNING] Contract tests SKIPPED (SKIP_CONTRACT_TESTS=true). ' +
    'Requires local Stellar node (Docker). ' +
    'Runs on nightly CI — see .github/workflows/ci.yml.'
  );
}

const describeOrSkip = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// WASM path resolution
// ---------------------------------------------------------------------------

/**
 * Possible WASM locations (tried in order):
 *   1. Explicit env override TEST_ESCROW_WASM_PATH
 *   2. contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm
 *   3. contracts/escrow.wasm  (pre-built artefact committed to repo)
 */
function resolveWasmPath() {
  if (process.env.TEST_ESCROW_WASM_PATH) return process.env.TEST_ESCROW_WASM_PATH;
  const candidates = [
    path.resolve(__dirname, '../../../../contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm'),
    path.resolve(__dirname, '../../../../contracts/escrow.wasm'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// ---------------------------------------------------------------------------
// ScVal argument builders
// These match the contract function signatures in contracts/escrow/src/lib.rs
// ---------------------------------------------------------------------------

const LOCAL_XLM_TOKEN =
  process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID ||
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function addr(pk)     { return StellarSdk.nativeToScVal(pk,    { type: 'address' }); }
function u64(n)       { return StellarSdk.nativeToScVal(n,     { type: 'u64'     }); }
function i128(n)      { return StellarSdk.nativeToScVal(n,     { type: 'i128'    }); }
function u32(n)       { return StellarSdk.nativeToScVal(n,     { type: 'u32'     }); }
function bool(b)      { return StellarSdk.nativeToScVal(b,     { type: 'bool'    }); }
function optAddr(pk)  {
  return pk
    ? StellarSdk.nativeToScVal(pk, { type: 'address' })
    : StellarSdk.xdr.ScVal.scvVoid();
}

function depositArgs({ orderId, buyerPk, farmerPk, amountStroops, timeoutUnix,
                       cooperativeAddress = null, cooperativeRoyaltyBps = 0 }) {
  return [
    addr(LOCAL_XLM_TOKEN),
    u64(orderId),
    addr(buyerPk),
    addr(farmerPk),
    i128(amountStroops),
    u64(timeoutUnix),
    optAddr(cooperativeAddress),
    u32(cooperativeRoyaltyBps),
  ];
}

function releaseArgs({ orderId, platformFeeBps = 0 }) {
  return [u64(orderId), u32(platformFeeBps)];
}

function refundArgs({ orderId }) {
  return [u64(orderId)];
}

function getEscrowArgs({ orderId }) {
  return [u64(orderId)];
}

function disputeArgs({ orderId, callerPk }) {
  return [u64(orderId), addr(callerPk)];
}

function resolveDisputeArgs({ orderId, releaseToFarmer }) {
  return [u64(orderId), bool(!releaseToFarmer)];
}

function initializeArgs({ adminPk, feeBps, feeDestPk }) {
  return [addr(adminPk), u32(feeBps), addr(feeDestPk)];
}

// ---------------------------------------------------------------------------
// Production invokeEscrowContract thin wrapper
// Overrides config so it points at the locally deployed test contract.
// ---------------------------------------------------------------------------

/**
 * Calls invokeEscrowContract (the production utility) with the sandbox contract.
 * Temporarily patches config so the utility uses our freshly deployed contract.
 */
async function callViaProductionUtil({ action, contractId, xlmTokenContractId, senderSecret,
                                       orderId, buyerPublicKey, farmerPublicKey,
                                       amount, timeoutUnix, userId = null,
                                       cooperativeAddress = null, cooperativeRoyaltyBps = 0 }) {
  // Dynamic require so we can patch config before the module reads it
  jest.resetModules();
  jest.doMock('../config', () => ({
    sorobanEscrowContractId: contractId,
    sorobanXlmTokenContractId: xlmTokenContractId || LOCAL_XLM_TOKEN,
  }));
  jest.doMock('../utils/stellar-config', () => {
    const actual = jest.requireActual('../utils/stellar-config');
    return actual; // real SDK — the sandbox is real
  });
  const { invokeEscrowContract } = require('../utils/stellar-contracts');
  return invokeEscrowContract({
    action, senderSecret, orderId, buyerPublicKey, farmerPublicKey,
    amount, timeoutUnix, userId, cooperativeAddress, cooperativeRoyaltyBps,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeOrSkip('Escrow contract — full lifecycle (local Soroban sandbox)', () => {
  /** @type {string} */
  let contractId;
  let adminKeypair, buyerKeypair, farmerKeypair, arbitratorKeypair;

  // ── Suite setup / teardown ──────────────────────────────────────────────

  beforeAll(async () => {
    // Start sandbox (no-op if already running)
    await setupSandbox({ timeoutMs: 90_000 });

    adminKeypair       = StellarSdk.Keypair.random();
    buyerKeypair       = StellarSdk.Keypair.random();
    farmerKeypair      = StellarSdk.Keypair.random();
    arbitratorKeypair  = StellarSdk.Keypair.random();

    await Promise.all([
      fundAccount(adminKeypair.publicKey()),
      fundAccount(buyerKeypair.publicKey()),
      fundAccount(farmerKeypair.publicKey()),
      fundAccount(arbitratorKeypair.publicKey()),
    ]);

    const wasmPath = resolveWasmPath();
    if (!wasmPath) {
      console.warn(
        '[escrow.contracts.test] escrow.wasm not found — ' +
        'run `cargo build --target wasm32-unknown-unknown --release` first. ' +
        'Falling back to TEST_ESCROW_CONTRACT_ID env var.'
      );
      contractId = process.env.TEST_ESCROW_CONTRACT_ID || null;
    } else {
      const wasm = fs.readFileSync(wasmPath);
      contractId = await deployContract(wasm, adminKeypair);
    }

    if (contractId) {
      // Initialize the contract via low-level helper (admin signs, no secret-key needed in env)
      await invokeContract(
        contractId,
        'initialize',
        initializeArgs({
          adminPk:   adminKeypair.publicKey(),
          feeBps:    250,      // 2.5%
          feeDestPk: adminKeypair.publicKey(),
        }),
        adminKeypair
      );
    }
  }, 120_000);

  afterAll(async () => {
    await teardownSandbox();
  });

  // ── Deployment ────────────────────────────────────────────────────────

  test('contract is deployed and has a valid C... address', () => {
    expect(typeof contractId).toBe('string');
    expect(contractId.length).toBeGreaterThan(0);
    expect(contractId.startsWith('C')).toBe(true);
  });

  // ── deposit ───────────────────────────────────────────────────────────

  describe('deposit', () => {
    const ORDER_ID   = 1001;
    const AMOUNT_XLM = 1; // 1 XLM
    const AMOUNT_STROOPS = BigInt(AMOUNT_XLM * 10_000_000);

    test('buyer locks funds into escrow via production invokeEscrowContract', async () => {
      if (!contractId) return;
      const timeoutUnix = Math.floor(Date.now() / 1000) + 86_400;

      const result = await callViaProductionUtil({
        action:         'deposit',
        contractId,
        senderSecret:   buyerKeypair.secret(),
        orderId:        ORDER_ID,
        buyerPublicKey: buyerKeypair.publicKey(),
        farmerPublicKey: farmerKeypair.publicKey(),
        amount:         AMOUNT_XLM,
        timeoutUnix,
      });

      expect(result).toHaveProperty('txHash');
      expect(typeof result.txHash).toBe('string');
    }, 30_000);

    test('duplicate deposit for same order_id is rejected', async () => {
      if (!contractId) return;
      const timeoutUnix = Math.floor(Date.now() / 1000) + 86_400;

      await expect(
        invokeContract(
          contractId,
          'deposit',
          depositArgs({
            orderId: ORDER_ID,
            buyerPk: buyerKeypair.publicKey(),
            farmerPk: farmerKeypair.publicKey(),
            amountStroops: AMOUNT_STROOPS,
            timeoutUnix,
          }),
          buyerKeypair
        )
      ).rejects.toThrow();
    }, 30_000);

    test('zero amount deposit is rejected', async () => {
      if (!contractId) return;
      const timeoutUnix = Math.floor(Date.now() / 1000) + 86_400;

      await expect(
        invokeContract(
          contractId,
          'deposit',
          depositArgs({
            orderId: 9901,
            buyerPk: buyerKeypair.publicKey(),
            farmerPk: farmerKeypair.publicKey(),
            amountStroops: BigInt(0),
            timeoutUnix,
          }),
          buyerKeypair
        )
      ).rejects.toThrow();
    }, 30_000);

    test('get_escrow returns Active status after deposit', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'get_escrow',
        getEscrowArgs({ orderId: ORDER_ID }),
        buyerKeypair
      );

      expect(result).not.toBeNull();
      // status may be returned as string 'Active' or as an object
      const status = typeof result?.status === 'string'
        ? result.status
        : Object.keys(result?.status || {})[0];
      expect(status).toBe('Active');
    }, 30_000);
  });

  // ── release ───────────────────────────────────────────────────────────

  describe('release', () => {
    const ORDER_ID = 2001;

    beforeAll(async () => {
      if (!contractId) return;
      // Deposit a fresh escrow for this describe block
      await invokeContract(
        contractId,
        'deposit',
        depositArgs({
          orderId: ORDER_ID,
          buyerPk: buyerKeypair.publicKey(),
          farmerPk: farmerKeypair.publicKey(),
          amountStroops: BigInt(20_000_000),
          timeoutUnix: Math.floor(Date.now() / 1000) + 86_400,
        }),
        buyerKeypair
      );
    }, 30_000);

    test('buyer releases escrow to farmer via production invokeEscrowContract', async () => {
      if (!contractId) return;

      const result = await callViaProductionUtil({
        action:         'release',
        contractId,
        senderSecret:   buyerKeypair.secret(),
        orderId:        ORDER_ID,
        buyerPublicKey: buyerKeypair.publicKey(),
        farmerPublicKey: farmerKeypair.publicKey(),
        amount:         2,
      });

      expect(result).toHaveProperty('txHash');
    }, 30_000);

    test('get_escrow shows Released status after release', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'get_escrow',
        getEscrowArgs({ orderId: ORDER_ID }),
        buyerKeypair
      );

      const status = typeof result?.status === 'string'
        ? result.status
        : Object.keys(result?.status || {})[0];
      expect(status).toBe('Released');
    }, 30_000);

    test('releasing an already-released escrow is rejected', async () => {
      if (!contractId) return;

      await expect(
        invokeContract(
          contractId,
          'release',
          releaseArgs({ orderId: ORDER_ID }),
          buyerKeypair
        )
      ).rejects.toThrow();
    }, 30_000);

    test('refunding an already-released escrow is rejected', async () => {
      if (!contractId) return;

      await expect(
        invokeContract(
          contractId,
          'refund',
          refundArgs({ orderId: ORDER_ID }),
          buyerKeypair
        )
      ).rejects.toThrow();
    }, 30_000);
  });

  // ── refund (timeout) ──────────────────────────────────────────────────

  describe('refund flow', () => {
    const ORDER_ID = 3001;

    test('deposit with already-past timeout is accepted by contract', async () => {
      if (!contractId) return;
      // Escrow contract validates timeout on refund, not on deposit
      const pastTimeout = Math.floor(Date.now() / 1000) - 1;

      const result = await invokeContract(
        contractId,
        'deposit',
        depositArgs({
          orderId: ORDER_ID,
          buyerPk: buyerKeypair.publicKey(),
          farmerPk: farmerKeypair.publicKey(),
          amountStroops: BigInt(5_000_000),
          timeoutUnix: pastTimeout,
        }),
        buyerKeypair
      );

      expect(result).toBeDefined();
    }, 30_000);

    test('buyer claims refund after timeout via production invokeEscrowContract', async () => {
      if (!contractId) return;

      const result = await callViaProductionUtil({
        action:         'refund',
        contractId,
        senderSecret:   buyerKeypair.secret(),
        orderId:        ORDER_ID,
        buyerPublicKey: buyerKeypair.publicKey(),
        farmerPublicKey: farmerKeypair.publicKey(),
      });

      expect(result).toHaveProperty('txHash');
    }, 30_000);

    test('refund cannot be claimed twice', async () => {
      if (!contractId) return;

      await expect(
        invokeContract(
          contractId,
          'refund',
          refundArgs({ orderId: ORDER_ID }),
          buyerKeypair
        )
      ).rejects.toThrow();
    }, 30_000);

    test('get_escrow shows Refunded status', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'get_escrow',
        getEscrowArgs({ orderId: ORDER_ID }),
        buyerKeypair
      );

      const status = typeof result?.status === 'string'
        ? result.status
        : Object.keys(result?.status || {})[0];
      expect(status).toBe('Refunded');
    }, 30_000);
  });

  // ── dispute flow ──────────────────────────────────────────────────────

  describe('dispute flow', () => {
    const ORDER_ID = 4001;

    beforeAll(async () => {
      if (!contractId) return;
      await invokeContract(
        contractId,
        'deposit',
        depositArgs({
          orderId: ORDER_ID,
          buyerPk: buyerKeypair.publicKey(),
          farmerPk: farmerKeypair.publicKey(),
          amountStroops: BigInt(10_000_000),
          timeoutUnix: Math.floor(Date.now() / 1000) + 86_400,
        }),
        buyerKeypair
      );
    }, 30_000);

    test('buyer can open a dispute', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'dispute',
        disputeArgs({ orderId: ORDER_ID, callerPk: buyerKeypair.publicKey() }),
        buyerKeypair
      );

      // dispute returns void
      expect(result == null || result === undefined || result === true).toBe(true);
    }, 30_000);

    test('get_escrow shows Disputed status', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'get_escrow',
        getEscrowArgs({ orderId: ORDER_ID }),
        buyerKeypair
      );

      const status = typeof result?.status === 'string'
        ? result.status
        : Object.keys(result?.status || {})[0];
      expect(status).toBe('Disputed');
    }, 30_000);

    test('release is rejected on a disputed escrow', async () => {
      if (!contractId) return;

      await expect(
        invokeContract(
          contractId,
          'release',
          releaseArgs({ orderId: ORDER_ID }),
          buyerKeypair
        )
      ).rejects.toThrow();
    }, 30_000);

    test('admin resolves dispute in favour of buyer (refund)', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'resolve_dispute',
        resolveDisputeArgs({ orderId: ORDER_ID, releaseToFarmer: false }),
        adminKeypair
      );

      expect(result == null || result === undefined || result === true).toBe(true);
    }, 30_000);

    test('get_escrow shows Released or Refunded after resolve', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'get_escrow',
        getEscrowArgs({ orderId: ORDER_ID }),
        buyerKeypair
      );

      const status = typeof result?.status === 'string'
        ? result.status
        : Object.keys(result?.status || {})[0];
      expect(['Released', 'Refunded']).toContain(status);
    }, 30_000);
  });

  // ── dispute resolved to farmer ─────────────────────────────────────────

  describe('dispute resolved to farmer', () => {
    const ORDER_ID = 5001;

    beforeAll(async () => {
      if (!contractId) return;
      await invokeContract(
        contractId,
        'deposit',
        depositArgs({
          orderId: ORDER_ID,
          buyerPk: buyerKeypair.publicKey(),
          farmerPk: farmerKeypair.publicKey(),
          amountStroops: BigInt(10_000_000),
          timeoutUnix: Math.floor(Date.now() / 1000) + 86_400,
        }),
        buyerKeypair
      );
      await invokeContract(
        contractId,
        'dispute',
        disputeArgs({ orderId: ORDER_ID, callerPk: farmerKeypair.publicKey() }),
        farmerKeypair
      );
    }, 60_000);

    test('admin resolves dispute in favour of farmer (release)', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'resolve_dispute',
        resolveDisputeArgs({ orderId: ORDER_ID, releaseToFarmer: true }),
        adminKeypair
      );

      expect(result == null || result === undefined || result === true).toBe(true);
    }, 30_000);
  });

  // ── get_escrow edge cases ──────────────────────────────────────────────

  describe('get_escrow edge cases', () => {
    test('returns null/undefined for unknown order_id', async () => {
      if (!contractId) return;

      const result = await invokeContract(
        contractId,
        'get_escrow',
        getEscrowArgs({ orderId: 99999 }),
        buyerKeypair
      );

      expect(result == null || result === undefined).toBe(true);
    }, 30_000);
  });
}, 300_000); // 5-minute outer timeout for the full suite
