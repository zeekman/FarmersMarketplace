/**
 * Integration tests for the Soroban escrow contract against a local Stellar node.
 *
 * Prerequisites:
 *   docker-compose -f docker-compose.test.yml up -d
 *
 * Run with:
 *   npm run test:contracts
 */

const path = require('path');
const fs = require('fs');
const StellarSdk = require('@stellar/stellar-sdk');
const { fundAccount, deployContract, invokeContract } = require('./helpers/soroban');

// Skip if no local node is configured (CI without Docker)
const SKIP = process.env.SKIP_CONTRACT_TESTS === 'true';

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip('Escrow contract (local Stellar node)', () => {
  let contractId;
  let buyerKeypair;
  let farmerKeypair;

  beforeAll(async () => {
    buyerKeypair = StellarSdk.Keypair.random();
    farmerKeypair = StellarSdk.Keypair.random();

    // Fund both accounts via local Friendbot
    await Promise.all([
      fundAccount(buyerKeypair.publicKey()),
      fundAccount(farmerKeypair.publicKey()),
    ]);

    // Deploy the escrow WASM if available
    const wasmPath = path.resolve(__dirname, '../../../../contracts/escrow.wasm');
    if (!fs.existsSync(wasmPath)) {
      console.warn('[test] escrow.wasm not found — skipping deploy, using env CONTRACT_ID');
      contractId = process.env.TEST_ESCROW_CONTRACT_ID;
      return;
    }

    const wasm = fs.readFileSync(wasmPath);
    contractId = await deployContract(wasm, buyerKeypair);
  }, 60_000);

  test('contract is deployed and has a valid address', () => {
    expect(typeof contractId).toBe('string');
    expect(contractId.length).toBeGreaterThan(0);
  });

  test('deposit: buyer can lock funds into escrow', async () => {
    if (!contractId) return;

    const orderId = 1;
    const amountStroops = BigInt(10_000_000); // 1 XLM

    const result = await invokeContract(
      contractId,
      'deposit',
      [
        StellarSdk.nativeToScVal(process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID || contractId, { type: 'address' }),
        StellarSdk.nativeToScVal(orderId, { type: 'u64' }),
        StellarSdk.nativeToScVal(buyerKeypair.publicKey(), { type: 'address' }),
        StellarSdk.nativeToScVal(farmerKeypair.publicKey(), { type: 'address' }),
        StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
        StellarSdk.nativeToScVal(Math.floor(Date.now() / 1000) + 86400, { type: 'u64' }),
      ],
      buyerKeypair
    );

    // deposit returns void or a success indicator
    expect(result).toBeDefined();
  }, 30_000);

  test('release: farmer can claim released escrow', async () => {
    if (!contractId) return;

    const orderId = 1;
    const result = await invokeContract(
      contractId,
      'release',
      [
        StellarSdk.nativeToScVal(process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID || contractId, { type: 'address' }),
        StellarSdk.nativeToScVal(orderId, { type: 'u64' }),
      ],
      farmerKeypair
    );

    expect(result).toBeDefined();
  }, 30_000);
}, 120_000);
