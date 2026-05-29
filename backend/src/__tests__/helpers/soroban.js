/**
 * Soroban test harness helpers.
 * Requires a local Stellar Quickstart node (docker-compose.test.yml).
 *
 * Usage:
 *   const { deployContract, invokeContract } = require('./helpers/soroban');
 */

const StellarSdk = require('@stellar/stellar-sdk');

const LOCAL_HORIZON = process.env.TEST_HORIZON_URL || 'http://localhost:8000';
const LOCAL_SOROBAN_RPC = process.env.TEST_SOROBAN_RPC_URL || 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE =
  process.env.TEST_NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';

const server = new StellarSdk.Horizon.Server(LOCAL_HORIZON, { allowHttp: true });
const sorobanServer = new StellarSdk.SorobanRpc.Server(LOCAL_SOROBAN_RPC, { allowHttp: true });

/**
 * Fund an account via the local Friendbot.
 * @param {string} publicKey
 */
async function fundAccount(publicKey) {
  const res = await fetch(`${LOCAL_HORIZON}/friendbot?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status}`);
  return res.json();
}

/**
 * Deploy a WASM contract to the local node.
 * @param {Buffer} wasmBuffer  Raw WASM bytes
 * @param {StellarSdk.Keypair} keypair  Deployer keypair (must be funded)
 * @returns {Promise<string>} Deployed contract address
 */
async function deployContract(wasmBuffer, keypair) {
  const account = await server.loadAccount(keypair.publicKey());

  // Upload WASM
  const uploadTx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(StellarSdk.Operation.uploadContractWasm({ wasm: wasmBuffer }))
    .setTimeout(30)
    .build();

  let uploadResult;
  try {
    const preparedUpload = await sorobanServer.prepareTransaction(uploadTx);
    preparedUpload.sign(keypair);
    uploadResult = await sorobanServer.sendTransaction(preparedUpload);
    await waitForTransaction(uploadResult.hash);
  } catch (err) {
    throw new Error(`WASM upload failed: ${err.message ?? err}`);
  }

  const wasmHash = StellarSdk.hash(wasmBuffer);

  // Create contract instance
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

  let receipt;
  try {
    const preparedCreate = await sorobanServer.prepareTransaction(createTx);
    preparedCreate.sign(keypair);
    const createResult = await sorobanServer.sendTransaction(preparedCreate);
    receipt = await waitForTransaction(createResult.hash);
  } catch (err) {
    throw new Error(`Contract instantiation failed: ${err.message ?? err}`);
  }

  // Extract contract address from result meta
  const contractId = StellarSdk.scValToNative(receipt.returnValue);
  return contractId;
}

/**
 * Invoke a contract function on the local node.
 * @param {string} contractId  Contract address
 * @param {string} method  Function name
 * @param {StellarSdk.xdr.ScVal[]} args  XDR ScVal arguments
 * @param {StellarSdk.Keypair} keypair  Signing keypair
 * @returns {Promise<unknown>} Native JS value of the return value
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

/**
 * Poll until a transaction is confirmed or failed.
 * @param {string} hash
 * @returns {Promise<object>} Transaction result
 */
async function waitForTransaction(hash, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await sorobanServer.getTransaction(hash);
    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') throw new Error(`Transaction ${hash} failed`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Transaction ${hash} timed out`);
}

module.exports = {
  server,
  sorobanServer,
  NETWORK_PASSPHRASE,
  fundAccount,
  deployContract,
  invokeContract,
  waitForTransaction,
};
