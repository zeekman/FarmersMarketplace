/**
 * Soroban test harness helpers — Issue #863
 *
 * Provides utilities for spinning up / tearing down a local Soroban sandbox
 * (stellar/quickstart Docker container) and invoking contracts against it.
 *
 * Usage:
 *   const { setupSandbox, teardownSandbox, deployContract, invokeContract } =
 *     require('./helpers/soroban');
 *
 * Full sandbox lifecycle (optional):
 *   await setupSandbox();   // starts Docker container if not already running
 *   ...tests...
 *   await teardownSandbox(); // stops & removes the container
 *
 * If the sandbox is already running (e.g. started manually via
 * `docker-compose -f docker-compose.test.yml up -d`), setupSandbox() is a
 * no-op and teardownSandbox() will not stop it.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const StellarSdk = require('@stellar/stellar-sdk');

// ---------------------------------------------------------------------------
// Network configuration
// ---------------------------------------------------------------------------
const LOCAL_HORIZON       = process.env.TEST_HORIZON_URL      || 'http://localhost:8000';
const LOCAL_SOROBAN_RPC   = process.env.TEST_SOROBAN_RPC_URL  || 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE  = process.env.TEST_NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';

/** Docker container name managed by this harness. */
const SANDBOX_CONTAINER = process.env.TEST_SANDBOX_CONTAINER || 'soroban-sandbox-test';

const server        = new StellarSdk.Horizon.Server(LOCAL_HORIZON, { allowHttp: true });
const sorobanServer = new StellarSdk.SorobanRpc.Server(LOCAL_SOROBAN_RPC, { allowHttp: true });

// ---------------------------------------------------------------------------
// Sandbox lifecycle
// ---------------------------------------------------------------------------

/** @type {boolean} True when this process started the container. */
let _sandboxStartedByUs = false;

/**
 * Ensure the local Soroban sandbox is running.
 * If a container named SANDBOX_CONTAINER is already up, this is a no-op.
 * Otherwise it starts a stellar/quickstart container in local mode.
 *
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
async function setupSandbox({ timeoutMs = 60_000 } = {}) {
  if (_isSandboxRunning()) {
    return; // already up — nothing to do
  }

  // Start the container
  const result = spawnSync(
    'docker',
    [
      'run', '--rm', '-d',
      '--name', SANDBOX_CONTAINER,
      '-p', '8000:8000',
      'stellar/quickstart:latest',
      '--local',
      '--enable-soroban-rpc',
    ],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to start Soroban sandbox: ${result.stderr || result.stdout || 'unknown error'}`
    );
  }

  _sandboxStartedByUs = true;

  // Wait for the RPC endpoint to become responsive
  await _waitForRpc(timeoutMs);
}

/**
 * Stop and remove the sandbox container if this process started it.
 * If the sandbox was already running when setupSandbox() was called,
 * this is a no-op.
 *
 * @returns {Promise<void>}
 */
async function teardownSandbox() {
  if (!_sandboxStartedByUs) return;
  try {
    execSync(`docker stop ${SANDBOX_CONTAINER}`, { stdio: 'ignore' });
  } catch { /* already stopped */ }
  _sandboxStartedByUs = false;
}

/** Returns true when the sandbox Docker container is running. */
function _isSandboxRunning() {
  try {
    const out = execSync(
      `docker inspect --format "{{.State.Running}}" ${SANDBOX_CONTAINER} 2>/dev/null`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/** Poll the Soroban RPC until it responds or timeoutMs elapses. */
async function _waitForRpc(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await sorobanServer.getLatestLedger();
      return; // responsive
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`Soroban RPC at ${LOCAL_SOROBAN_RPC} did not become ready within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Account funding
// ---------------------------------------------------------------------------

/**
 * Fund an account via the local Friendbot.
 * @param {string} publicKey
 */
async function fundAccount(publicKey) {
  const res = await fetch(`${LOCAL_HORIZON}/friendbot?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Contract deployment
// ---------------------------------------------------------------------------

/**
 * Upload a WASM buffer and instantiate a contract on the local node.
 *
 * @param {Buffer} wasmBuffer  Raw WASM bytes
 * @param {StellarSdk.Keypair} keypair  Deployer keypair (must be funded)
 * @returns {Promise<string>} Deployed contract address (C... strkey)
 */
async function deployContract(wasmBuffer, keypair) {
  const account = await server.loadAccount(keypair.publicKey());

  // ── Step 1: upload WASM ─────────────────────────────────────────────────
  const uploadTx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(StellarSdk.Operation.uploadContractWasm({ wasm: wasmBuffer }))
    .setTimeout(30)
    .build();

  let uploadPrepared;
  try {
    uploadPrepared = await sorobanServer.prepareTransaction(uploadTx);
    uploadPrepared.sign(keypair);
  } catch (err) {
    throw new Error(`WASM upload failed: ${err.message ?? err}`);
  }

  let uploadSend;
  try {
    uploadSend = await sorobanServer.sendTransaction(uploadPrepared);
  } catch (err) {
    throw new Error(`WASM upload failed: ${err.message ?? err}`);
  }

  await waitForTransaction(uploadSend.hash);

  // ── Step 2: create contract instance ───────────────────────────────────
  const wasmHash = StellarSdk.hash(wasmBuffer);
  const account2 = await server.loadAccount(keypair.publicKey());

  const createTx = new StellarSdk.TransactionBuilder(account2, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.createCustomContract({
        wasmHash,
        address: new StellarSdk.Address(keypair.publicKey()),
        salt: StellarSdk.hash(Buffer.from(Date.now().toString())),
      })
    )
    .setTimeout(30)
    .build();

  let createPrepared;
  try {
    createPrepared = await sorobanServer.prepareTransaction(createTx);
    createPrepared.sign(keypair);
  } catch (err) {
    throw new Error(`Contract instantiation failed: ${err.message ?? err}`);
  }

  let createSend;
  try {
    createSend = await sorobanServer.sendTransaction(createPrepared);
  } catch (err) {
    throw new Error(`Contract instantiation failed: ${err.message ?? err}`);
  }

  const receipt = await waitForTransaction(createSend.hash);
  return StellarSdk.scValToNative(receipt.returnValue);
}

// ---------------------------------------------------------------------------
// Contract invocation
// ---------------------------------------------------------------------------

/**
 * Call a contract function on the local node and return the native JS result.
 *
 * @param {string} contractId
 * @param {string} method
 * @param {StellarSdk.xdr.ScVal[]} args
 * @param {StellarSdk.Keypair} keypair
 * @returns {Promise<unknown>}
 */
async function invokeContract(contractId, method, args, keypair) {
  const account = await server.loadAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const prepared = await sorobanServer.prepareTransaction(tx);
  prepared.sign(keypair);
  const sendResult = await sorobanServer.sendTransaction(prepared);
  const receipt = await waitForTransaction(sendResult.hash);
  return StellarSdk.scValToNative(receipt.returnValue);
}

// ---------------------------------------------------------------------------
// Transaction polling
// ---------------------------------------------------------------------------

/**
 * Poll until a transaction is confirmed (SUCCESS) or failed (FAILED/timeout).
 *
 * @param {string} hash
 * @param {number} [maxAttempts=20]
 * @returns {Promise<object>} Transaction result
 */
async function waitForTransaction(hash, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await sorobanServer.getTransaction(hash);
    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') throw new Error(`Transaction ${hash} failed on-chain`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Transaction ${hash} timed out after ${maxAttempts} polls`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  // servers (exposed for tests that need direct access)
  server,
  sorobanServer,
  NETWORK_PASSPHRASE,
  LOCAL_HORIZON,
  LOCAL_SOROBAN_RPC,
  SANDBOX_CONTAINER,
  // sandbox lifecycle
  setupSandbox,
  teardownSandbox,
  _isSandboxRunning,
  _waitForRpc,
  // helpers
  fundAccount,
  deployContract,
  invokeContract,
  waitForTransaction,
};
