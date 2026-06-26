const crypto = require('crypto');
const config = require('../config');
const db = require('../db/schema');
const { StellarSdk, isTestnet, server, sorobanServer, networkPassphrase } = require('./stellar-config');

function normalizeWasmHash(h) {
  if (h == null || typeof h !== 'string') return null;
  const x = h.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(x)) return null;
  return x;
}

function hashArgs(args) {
  try {
    const json = JSON.stringify(args);
    return crypto.createHash('sha256').update(json).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

/**
 * Appends a row to `contract_invocations` for audit/observability. Non-fatal — errors are swallowed.
 * @param {{ contractId: string, method: string, args: object, txHash: string|null, success: boolean, error: string|null, userId: number|null }} params
 */
async function logEscrowInvocation({ contractId, method, args, txHash, success, error, userId }) {
  try {
    const argsHash = hashArgs(args);
    await db.query(
      `INSERT INTO contract_invocations
         (contract_id, method, args, result, tx_hash, success, error, invoked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contractId,
        method,
        args != null ? JSON.stringify(args) : null,
        argsHash,
        txHash || null,
        success ? 1 : 0,
        error || null,
        userId || null,
      ]
    );
  } catch {
    // Non-fatal — logging must never break the escrow flow.
  }
}

/**
 * Reads all persistent ledger entries for a contract, optionally filtered by key prefix.
 * @param {string} contractId  Strkey-encoded contract address (C…)
 * @param {string|null} [prefix]  If set, only entries whose key starts with this string are returned
 * @returns {Promise<Array<{ key: string, val: unknown, durability: string, lastModifiedLedgerSeq: number|null }>>}
 * @throws {{ code: 404 }} if the contract is not found
 */
async function getContractState(contractId, prefix = null) {
  const contractAddress = new StellarSdk.Address(contractId);
  const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
    })
  );

  let response;
  try {
    response = await sorobanServer.getLedgerEntries(ledgerKey);
  } catch (e) {
    if (e.message?.includes('not found') || e.code === 404) {
      const notFound = new Error('Contract not found');
      notFound.code = 404;
      throw notFound;
    }
    throw e;
  }

  return (response.entries || [])
    .map((entry) => {
      const data = entry.val?.contractData?.();
      const key = data ? StellarSdk.scValToNative(data.key()) : String(entry.key);
      const val = data ? StellarSdk.scValToNative(data.val()) : null;
      const durability = data?.durability()?.name || 'Persistent';
      const lastModifiedLedgerSeq = entry.lastModifiedLedgerSeq ?? null;
      return { key: String(key), val, durability, lastModifiedLedgerSeq };
    })
    .filter((e) => !prefix || String(e.key).startsWith(prefix));
}

/**
 * Returns the 64-character hex WASM hash of the deployed contract bytecode.
 * @param {string} contractId
 * @returns {Promise<string>} Lowercase hex WASM hash
 * @throws {{ code: 404 }} if the contract instance is not on the ledger
 * @throws {{ code: 'not_wasm_contract' }} if the contract uses a built-in executable
 * @throws {{ code: 'parse_error' }} if the ledger entry cannot be decoded
 */
async function getContractWasmHash(contractId) {
  const contractAddress = new StellarSdk.Address(contractId);
  const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
    })
  );

  let response;
  try {
    response = await sorobanServer.getLedgerEntries(ledgerKey);
  } catch (e) {
    if (e.message?.includes('not found') || e.code === 404) {
      const notFound = new Error('Contract not found');
      notFound.code = 404;
      throw notFound;
    }
    throw e;
  }

  const list = response.entries || [];
  if (!list.length) {
    const notFound = new Error('Contract instance not found on ledger');
    notFound.code = 404;
    throw notFound;
  }

  const data = list[0].val?.contractData?.();
  if (!data) {
    const err = new Error('Unexpected ledger entry shape');
    err.code = 'parse_error';
    throw err;
  }

  const scVal = data.val();
  let instance;
  try {
    instance = scVal.contractInstance();
  } catch {
    const err = new Error('Contract data is not a contract instance');
    err.code = 'parse_error';
    throw err;
  }

  const exec = instance.executable();
  const sw = exec.switch();
  const wasmArm = StellarSdk.xdr.ContractExecutableType.contractExecutableWasm();
  const isWasm = sw === wasmArm || sw?.name === wasmArm?.name || String(sw).includes('Wasm');
  if (!isWasm) {
    const err = new Error('Contract executable is not WASM');
    err.code = 'not_wasm_contract';
    throw err;
  }

  const raw =
    typeof exec.wasmHash === 'function'
      ? exec.wasmHash()
      : typeof exec.value === 'function'
        ? exec.value()
        : null;
  if (!raw) {
    const err = new Error('SDK cannot read WASM hash from executable');
    err.code = 'parse_error';
    throw err;
  }

  const hash = Buffer.from(raw).toString('hex').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    const e = new Error(`Unexpected WASM hash format: ${hash}`);
    e.code = 'parse_error';
    throw e;
  }
  return hash;
}

/**
 * Dry-runs a Soroban contract method via the RPC simulation endpoint. Never submits a transaction.
 * Uses `SOROBAN_SIMULATION_SOURCE_PUBLIC_KEY` (or `PLATFORM_WALLET_PUBLIC_KEY`) as the fee-source account.
 * @param {string} contractId
 * @param {string} method  Contract function name
 * @param {Array<{ type: string, value: unknown }>} [args]  Typed argument list
 * @returns {Promise<{ success: boolean, fee: string|null, result: unknown, error: string|null }>}
 * @throws {{ code: 'simulation_source_unconfigured' }} if no source account is configured
 * @throws {{ code: 'sdk_incompatible' }} if the installed SDK lacks simulation helpers
 */
async function simulateContractCall(contractId, method, args = []) {
  const sourcePublic = (
    config.sorobanSimulationSourcePublicKey ||
    config.platformWalletPublicKey ||
    ''
  ).trim();

  if (!sourcePublic) {
    const e = new Error(
      'Configure SOROBAN_SIMULATION_SOURCE_PUBLIC_KEY or PLATFORM_WALLET_PUBLIC_KEY.'
    );
    e.code = 'simulation_source_unconfigured';
    throw e;
  }

  const SorobanApi = StellarSdk.rpc?.Api;
  if (!SorobanApi?.isSimulationSuccess) {
    const e = new Error('Stellar SDK is missing rpc.Api simulation helpers; upgrade @stellar/stellar-sdk.');
    e.code = 'sdk_incompatible';
    throw e;
  }

  let account;
  try {
    account = await server.loadAccount(sourcePublic);
  } catch (loadErr) {
    if (loadErr.response?.status === 404) {
      const e = new Error(`Simulation source account not found on ${config.stellarNetwork}: ${sourcePublic}`);
      e.code = 'simulation_source_not_found';
      throw e;
    }
    throw loadErr;
  }

  const scParams = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a || typeof a !== 'object' || typeof a.type !== 'string' || !('value' in a)) {
      const e = new Error(`args[${i}] must be { "type": "<soroban type>", "value": <json> }`);
      e.code = 'invalid_arg';
      throw e;
    }
    scParams.push(StellarSdk.nativeToScVal(a.value, { type: a.type }));
  }

  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...scParams))
    .setTimeout(60)
    .build();

  let sim;
  try {
    sim = await sorobanServer.simulateTransaction(tx);
  } catch (rpcErr) {
    return { success: false, fee: null, result: null, error: rpcErr.message || 'Soroban RPC simulateTransaction failed' };
  }

  if (SorobanApi.isSimulationError(sim)) {
    const msg = typeof sim.error === 'string' ? sim.error : JSON.stringify(sim.error ?? 'Simulation error');
    return { success: false, fee: null, result: null, error: msg };
  }

  if (!SorobanApi.isSimulationSuccess(sim)) {
    return { success: false, fee: null, result: null, error: 'Unexpected simulation response from RPC' };
  }

  const baseFee = BigInt(StellarSdk.BASE_FEE);
  const resourceFee = BigInt(sim.minResourceFee || '0');
  const fee = (baseFee + resourceFee).toString();

  let decoded = null;
  if (sim.result?.retval) {
    try {
      decoded = StellarSdk.scValToNative(sim.result.retval);
    } catch {
      try { decoded = sim.result.retval.toXDR('base64'); } catch { decoded = null; }
    }
  }

  if (SorobanApi.isSimulationRestore(sim)) {
    return {
      success: true,
      fee,
      result: {
        returnValue: decoded,
        restoreRequired: true,
        restoreMinResourceFee: sim.restorePreamble?.minResourceFee != null
          ? String(sim.restorePreamble.minResourceFee)
          : null,
      },
      error: null,
    };
  }

  return { success: true, fee, result: decoded, error: null };
}

/**
 * Invokes a lifecycle action on the Soroban escrow contract and polls until confirmed.
 * Logs every attempt to `contract_invocations`.
 * @param {{ action: 'deposit'|'release'|'refund'|'dispute', senderSecret: string, orderId: number, buyerPublicKey: string, farmerPublicKey: string, amount: number, timeoutUnix: number, userId: number|null }} params
 * @returns {Promise<{ txHash: string, contractId: string }>}
 * @throws if the contract IDs are unconfigured, submission fails, or confirmation times out after 15 s
 */
async function invokeEscrowContract({ action, senderSecret, orderId, buyerPublicKey, farmerPublicKey, amount, timeoutUnix, userId }) {
  const contractId = config.sorobanEscrowContractId;
  const xlmTokenContractId = config.sorobanXlmTokenContractId;
  if (!contractId) throw new Error('SOROBAN_ESCROW_CONTRACT_ID is not configured');
  if (!xlmTokenContractId) throw new Error('SOROBAN_XLM_TOKEN_CONTRACT_ID is not configured');

  const keypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const source = await server.loadAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const logArgs = { action, orderId, buyerPublicKey, farmerPublicKey, amount, timeoutUnix };

  let operation;
  if (action === 'deposit') {
    const amountStroops = BigInt(Math.round(Number(amount) * 10_000_000));
    operation = contract.call(
      'deposit',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' }),
      StellarSdk.nativeToScVal(buyerPublicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(farmerPublicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(Number(timeoutUnix), { type: 'u64' })
    );
  } else if (action === 'release') {
    operation = contract.call(
      'release',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' })
    );
  } else if (action === 'refund') {
    operation = contract.call(
      'refund',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' })
    );
  } else if (action === 'dispute') {
    operation = contract.call(
      'dispute',
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' }),
      StellarSdk.nativeToScVal(keypair.publicKey(), { type: 'address' })
    );
  } else {
    throw new Error(`Unsupported Soroban escrow action: ${action}`);
  }

  let tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  tx = await sorobanServer.prepareTransaction(tx);
  tx.sign(keypair);

  let sendResult;
  try {
    sendResult = await sorobanServer.sendTransaction(tx);
  } catch (submitErr) {
    await logEscrowInvocation({ contractId, method: action, args: logArgs, txHash: null, success: false, error: submitErr.message, userId });
    throw submitErr;
  }

  if (sendResult.status === 'ERROR') {
    const errMsg = sendResult.errorResultXdr || 'Soroban transaction submission failed';
    await logEscrowInvocation({ contractId, method: action, args: logArgs, txHash: null, success: false, error: errMsg, userId });
    throw new Error(errMsg);
  }

  const hash = sendResult.hash || tx.hash().toString('hex');
  for (let i = 0; i < 15; i += 1) {
    const txResult = await sorobanServer.getTransaction(hash);
    if (txResult.status === 'SUCCESS') {
      await logEscrowInvocation({ contractId, method: action, args: logArgs, txHash: hash, success: true, error: null, userId });
      return { txHash: hash, contractId };
    }
    if (txResult.status === 'FAILED') {
      await logEscrowInvocation({ contractId, method: action, args: logArgs, txHash: hash, success: false, error: 'Soroban transaction failed', userId });
      throw new Error('Soroban transaction failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const timeoutErr = 'Soroban transaction confirmation timed out';
  await logEscrowInvocation({ contractId, method: action, args: logArgs, txHash: hash, success: false, error: timeoutErr, userId });
  throw new Error(timeoutErr);
}

/**
 * Reads an order's escrow record from the Soroban escrow contract via simulation
 * (read-only — no transaction is submitted). Returns `null` when the record does
 * not exist on-chain so callers can respond with a 404.
 * @param {number|string} orderId
 * @returns {Promise<null | { status: string, buyer: string|null, farmer: string|null, amount: number|null, timeoutUnix: number|null, escrowAddress: string, lastUpdatedLedger: number|null }>}
 */
async function getEscrowState(orderId) {
  const contractId = config.sorobanEscrowContractId;
  if (!contractId) throw new Error('SOROBAN_ESCROW_CONTRACT_ID is not configured');

  const sim = await simulateContractCall(contractId, 'get_escrow', [
    { type: 'u64', value: Number(orderId) },
  ]);

  if (!sim.success) {
    const msg = sim.error || '';
    // The contract traps / returns an error when the escrow does not exist.
    if (/not\s*found|missing|no\s*such|does not exist|UnreachableCodeReached/i.test(msg)) {
      return null;
    }
    const e = new Error(`Failed to read escrow state: ${msg}`);
    e.code = 'escrow_read_failed';
    throw e;
  }

  const data = sim.result;
  if (data === null || data === undefined) return null;

  // scValToNative yields the contract struct's own field keys; map defensively.
  const amountRaw = data.amount ?? data.amount_stroops ?? null;
  const amount = amountRaw == null ? null : Number(amountRaw) / 10_000_000;
  const timeoutUnix = data.timeout ?? data.timeout_unix ?? data.timeout_at ?? null;

  return {
    status: data.status != null ? String(data.status) : 'unknown',
    buyer: data.buyer ?? null,
    farmer: data.farmer ?? null,
    amount,
    timeoutUnix: timeoutUnix != null ? Number(timeoutUnix) : null,
    escrowAddress: contractId,
    lastUpdatedLedger: data.last_updated_ledger ?? null,
  };
}

/**
 * General-purpose Soroban contract invocation. Prepares, signs, submits, and polls for confirmation.
 * @param {{ contractId: string, method: string, args?: Array<{ type: string, value: unknown }>, signerSecret: string }} params
 * @returns {Promise<{ hash: string, result: unknown }>}
 * @throws if the transaction fails or times out after 10 polls (2 s each)
 */
async function invokeContract({ contractId, method, args = [], signerSecret }) {
  const keypair = StellarSdk.Keypair.fromSecret(signerSecret);
  const source = await server.loadAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const scArgs = args.map((arg) => StellarSdk.nativeToScVal(arg.value, { type: arg.type }));
  let tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(60)
    .build();
  tx = await sorobanServer.prepareTransaction(tx);
  tx.sign(keypair);
  const sendResult = await sorobanServer.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Soroban RPC Error: ${sendResult.errorResultXdr}`);
  }
  const hash = sendResult.hash;
  for (let i = 0; i < 10; i++) {
    const txResult = await sorobanServer.getTransaction(hash);
    if (txResult.status === 'SUCCESS') return { hash, result: txResult.returnValue };
    if (txResult.status === 'FAILED') throw new Error('Soroban transaction failed');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Transaction confirmation timeout');
}

/**
 * Simpler simulation wrapper used by admin routes — does not support typed arg objects.
 * Uses `PLATFORM_WALLET_PUBLIC_KEY` as the source account.
 * @param {{ contractId: string, method: string, args?: Array<{ type: string, value: unknown }> }} params
 * @returns {Promise<object>} Raw Soroban RPC simulation response
 */
async function simulateContract({ contractId, method, args = [] }) {
  const sourcePublic = config.platformWalletPublicKey;
  const account = await server.loadAccount(sourcePublic);
  const contract = new StellarSdk.Contract(contractId);
  const scArgs = args.map((arg) => StellarSdk.nativeToScVal(arg.value, { type: arg.type }));
  const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(60)
    .build();
  const sim = await sorobanServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.error)}`);
  }
  return sim;
}

/**
 * Attempts to decode the contract spec (ABI) from the ledger instance entry.
 * Returns an empty array if the spec is absent or cannot be parsed — the contract still works.
 * @param {string} contractId
 * @returns {Promise<Array<{ name: string, params: Array<{ name: string, type: string }>, returnType: string }>>}
 */
async function getContractABI(contractId) {
  try {
    const contractAddress = new StellarSdk.Address(contractId);
    const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
      new StellarSdk.xdr.LedgerKeyContractData({
        contract: contractAddress.toScAddress(),
        key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: StellarSdk.xdr.ContractDataDurability.persistent(),
      })
    );
    const response = await sorobanServer.getLedgerEntries(ledgerKey);
    const entries = response.entries || [];
    if (!entries.length) {
      const err = new Error('Contract not found');
      err.code = 404;
      throw err;
    }
    const data = entries[0].val?.contractData?.();
    if (!data) {
      const err = new Error('Cannot parse contract data');
      err.code = 'parse_error';
      throw err;
    }
    let instance;
    try {
      instance = data.val().contractInstance();
    } catch {
      const err = new Error('Contract data is not a contract instance');
      err.code = 'parse_error';
      throw err;
    }
    const spec = instance.contractSpec?.();
    if (!spec || !spec.length) return [];
    const functions = [];
    for (const specEntry of spec) {
      const xdrType = specEntry.switch?.();
      if (!xdrType || xdrType.name !== 'UdtStructV0') continue;
      const struct = specEntry.value?.();
      if (!struct) continue;
      const fields = struct.fields?.() || [];
      const params = (fields).map((field) => ({
        name: field.name?.(),
        type: field.type?.switch?.()?.name || 'unknown',
      }));
      functions.push({ name: struct.name?.(), params, returnType: 'void' });
    }
    return functions;
  } catch (error) {
    if (error.code === 404) throw error;
    console.error('[Stellar] Error fetching contract ABI:', error.message);
    return [];
  }
}

/**
 * Runs a batch of simulation test-cases and returns fee/resource estimates for each.
 * @param {string} contractId
 * @param {Array<{ method: string, args?: Array<{ type: string, value: unknown }> }>} [testCases]
 * @returns {Promise<Array<{ method: string, fee: string|null, fee_stroops: string|null, cpu_insns: number|null, mem_bytes: number|null, ledger_reads: number|null, ledger_writes: number|null, error: string|null }>>}
 */
async function analyzeContractFees(contractId, testCases = []) {
  const results = [];
  for (const { method, args = [] } of testCases) {
    try {
      const sim = await simulateContractCall(contractId, method, args);
      if (!sim.success) {
        results.push({ method, args, fee: null, cpu_insns: null, mem_bytes: null, ledger_reads: null, ledger_writes: null, error: sim.error });
        continue;
      }
      const feeNum = BigInt(sim.fee || '0');
      const feeXlm = (Number(feeNum) / 10_000_000).toFixed(7);
      results.push({
        method, args, fee: feeXlm, fee_stroops: sim.fee,
        cpu_insns: sim.result?.cpuInsns || null,
        mem_bytes: sim.result?.memBytes || null,
        ledger_reads: sim.result?.ledgerReads || null,
        ledger_writes: sim.result?.ledgerWrites || null,
        error: null,
      });
    } catch (error) {
      results.push({ method, args, fee: null, cpu_insns: null, mem_bytes: null, ledger_reads: null, ledger_writes: null, error: error.message });
    }
  }
  return results;
}

/**
 * Fetches and paginates Soroban events emitted by a contract, with optional date-range filtering.
 * Defaults to the last ~24 h of ledgers (17 280 ledgers ≈ 86 400 s at 5 s/ledger).
 * @param {string} contractId
 * @param {{ type?: string, from?: string, to?: string, page?: number, limit?: number }} [filters]
 * @returns {Promise<{ events: object[], pagination: { page: number, pages: number, total: number, limit: number } }>}
 */
async function getContractEvents(contractId, filters = {}) {
  const { type, from, to, page = 1, limit = 20 } = filters;
  const latestLedger = await sorobanServer.getLatestLedger();
  const startLedger = from
    ? Math.max(1, latestLedger.sequence - Math.ceil((Date.now() / 1000 - Math.floor(new Date(from).getTime() / 1000)) / 5))
    : Math.max(1, latestLedger.sequence - 17280);

  const response = await sorobanServer.getEvents({
    startLedger,
    filters: [{ type: type || 'contract', contractIds: [contractId] }],
    limit: 200,
  });

  let events = (response.events || []).map((ev) => {
    const topics = (ev.topic || []).map((t) => {
      try { return StellarSdk.scValToNative(t); } catch { return t.toXDR('base64'); }
    });
    let data = null;
    try { data = StellarSdk.scValToNative(ev.value); } catch { data = ev.value?.toXDR?.('base64') ?? null; }
    return { id: ev.id, ledger: ev.ledger, ledgerClosedAt: ev.ledgerClosedAt, type: ev.type, contractId: ev.contractId, topics, data };
  });

  if (from) events = events.filter((e) => new Date(e.ledgerClosedAt) >= new Date(from));
  if (to) events = events.filter((e) => new Date(e.ledgerClosedAt) <= new Date(to));

  const total = events.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  return { events: events.slice(offset, offset + limit), pagination: { page, pages, total, limit } };
}

/**
 * Decodes the contract spec and returns a Map of `functionName → "(param: type, …) -> returnType"` strings.
 * Returns an empty Map if the spec is absent or unparseable.
 * @param {string} contractId
 * @returns {Promise<Map<string, string>>}
 */
async function getContractFunctionSignatures(contractId) {
  const contractAddress = new StellarSdk.Address(contractId);
  const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
    })
  );

  let response;
  try {
    response = await sorobanServer.getLedgerEntries(ledgerKey);
  } catch (e) {
    if (e.message?.includes('not found') || e.code === 404) {
      const notFound = new Error('Contract not found');
      notFound.code = 404;
      throw notFound;
    }
    throw e;
  }

  const entries = response.entries || [];
  if (!entries.length) {
    const notFound = new Error('Contract instance not found on ledger');
    notFound.code = 404;
    throw notFound;
  }

  const data = entries[0].val?.contractData?.();
  if (!data) return new Map();

  let instance;
  try {
    instance = data.val().contractInstance();
  } catch {
    return new Map();
  }

  const spec = instance.contractSpec?.();
  if (!spec || !spec.length) return new Map();

  const signatures = new Map();
  for (const entry of spec) {
    try {
      const fn = entry.functionV0?.();
      if (!fn) continue;
      const name = fn.name?.().toString() || '';
      const inputs = (fn.inputs?.() || [])
        .map((i) => `${i.name?.()}: ${i.type?.switch?.()?.name || 'unknown'}`)
        .join(', ');
      const outputs = (fn.outputs?.() || [])
        .map((o) => o.switch?.()?.name || 'unknown')
        .join(', ');
      signatures.set(name, `(${inputs}) -> ${outputs || 'void'}`);
    } catch {
      // skip unparseable entries
    }
  }
  return signatures;
}

/**
 * Uploads WASM bytecode and instantiates a new Soroban contract in two transactions.
 * @param {{ wasmBuffer: Buffer, deployerSecret: string }} params
 * @returns {Promise<{ contractId: string, wasmHash: string, txHash: string }>}
 * @throws if either upload or instantiation fails, or if the contract ID cannot be extracted
 */
async function deployContract({ wasmBuffer, deployerSecret }) {
  const deployerKeypair = StellarSdk.Keypair.fromSecret(deployerSecret);
  const deployerAccount = await server.loadAccount(deployerKeypair.publicKey());
  const wasmHash = StellarSdk.hash(wasmBuffer);

  let tx = new StellarSdk.TransactionBuilder(deployerAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.uploadContractWasm({ wasm: wasmBuffer }))
    .setTimeout(60)
    .build();
  tx = await sorobanServer.prepareTransaction(tx);
  tx.sign(deployerKeypair);

  const uploadResult = await sorobanServer.sendTransaction(tx);
  if (uploadResult.status === 'ERROR') throw new Error(uploadResult.errorResultXdr || 'WASM upload failed');

  const uploadHash = uploadResult.hash;
  for (let i = 0; i < 15; i++) {
    const txResult = await sorobanServer.getTransaction(uploadHash);
    if (txResult.status === 'SUCCESS') break;
    if (txResult.status === 'FAILED') throw new Error('WASM upload transaction failed');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const createAccount = await server.loadAccount(deployerKeypair.publicKey());
  tx = new StellarSdk.TransactionBuilder(createAccount, { fee: StellarSdk.BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.createContract({ wasmHash }))
    .setTimeout(60)
    .build();
  tx = await sorobanServer.prepareTransaction(tx);
  tx.sign(deployerKeypair);

  const createResult = await sorobanServer.sendTransaction(tx);
  if (createResult.status === 'ERROR') throw new Error(createResult.errorResultXdr || 'Contract instantiation failed');

  const createHash = createResult.hash;
  for (let i = 0; i < 15; i++) {
    const txResult = await sorobanServer.getTransaction(createHash);
    if (txResult.status === 'SUCCESS') {
      const contractId = txResult.resultMetaXdr?.v3()?.sorobanMeta()?.events()?.[0]?.contractEvent()?.contractId()?.contractId()?.toString('hex');
      if (contractId) {
        return {
          contractId: StellarSdk.StrKey.encodeContract(StellarSdk.xdr.ScAddressType.scAddressTypeContract().value, Buffer.from(contractId, 'hex')),
          wasmHash: wasmHash.toString('hex'),
          txHash: createHash,
        };
      }
      break;
    }
    if (txResult.status === 'FAILED') throw new Error('Contract instantiation transaction failed');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Failed to extract contract ID from transaction result');
}

module.exports = {
  normalizeWasmHash,
  getContractState,
  getContractWasmHash,
  simulateContractCall,
  invokeEscrowContract,
  getEscrowState,
  invokeContract,
  simulateContract,
  getContractABI,
  analyzeContractFees,
  getContractEvents,
  getContractFunctionSignatures,
  deployContract,
};
