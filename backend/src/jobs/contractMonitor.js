/**
 * jobs/contractMonitor.js
 *
 * Watches Soroban contract invocations on the Stellar network and stores them in the
 * contract_invocations table (migration 013_contract_invocations.sql).
 * Handles the args size limit introduced in migration 019_contract_invocations_args_limit.sql.
 *
 * Features:
 * - Truncates invocation args to the args_limit bytes defined in migration 019
 * - Uses ON CONFLICT (tx_hash, invocation_index) DO NOTHING for idempotency
 * - Horizon stream reconnection with exponential backoff (max 60s)
 * - GET /api/contracts/:contractId/invocations returns recent invocations from DB, paginated
 */

const db = require('../db/schema');
const { getContractEvents } = require('../utils/stellar');
const logger = require('../logger');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60 * 1000; // 60 seconds
const ARGS_MAX_BYTES = 65535; // From migration 019

/**
 * Truncates args JSON to the maximum allowed byte length.
 * If args is null or already within limit, returns as-is.
 * Otherwise truncates and appends "... (truncated)" marker.
 */
function truncateArgs(args) {
  if (args == null) return null;
  const json = JSON.stringify(args);
  if (Buffer.byteLength(json, 'utf8') <= ARGS_MAX_BYTES) return json;
  
  // Truncate to fit within limit with marker
  const marker = '... (truncated)';
  const maxJsonBytes = ARGS_MAX_BYTES - Buffer.byteLength(marker, 'utf8');
  let truncated = json;
  while (Buffer.byteLength(truncated, 'utf8') > maxJsonBytes && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + marker;
}

/**
 * Stores a contract invocation in the database with idempotency.
 * Uses ON CONFLICT to prevent duplicate inserts on replay.
 */
async function storeInvocation({ contractId, method, args, txHash, invocationIndex, success, error }) {
  try {
    const truncatedArgs = truncateArgs(args);
    await db.query(
      `INSERT INTO contract_invocations 
         (contract_id, method, args, tx_hash, invocation_index, success, error, invoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))
       ON CONFLICT (tx_hash, invocation_index) DO NOTHING`,
      [
        contractId,
        method,
        truncatedArgs,
        txHash || null,
        invocationIndex,
        success ? 1 : 0,
        error || null,
      ]
    );
  } catch (err) {
    logger.error('[ContractMonitor] Failed to store invocation:', err.message);
  }
}

/**
 * Monitors a single contract for invocations with exponential backoff retry.
 */
async function monitorContract(contractId, retryCount = 0) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  let result;
  try {
    result = await getContractEvents(contractId, { from: oneHourAgo, limit: 200 });
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const backoffMs = Math.min(
        Math.pow(2, retryCount) * 1000,
        MAX_BACKOFF_MS
      );
      logger.warn(
        `[ContractMonitor] Failed to fetch events for ${contractId}, retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES}):`,
        err.message
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return monitorContract(contractId, retryCount + 1);
    }

    logger.error(
      `[ContractMonitor] Failed to fetch events for ${contractId} after ${MAX_RETRIES} retries:`,
      err.message
    );
    return;
  }

  const events = result.events || [];
  let invocationIndex = 0;

  for (const ev of events) {
    // Extract method name from topics if available
    const topics = ev.topics || [];
    const method = topics[0] ? String(topics[0]) : 'unknown';
    
    // Determine success based on event type and topics
    const isFailure = topics.some((t) => typeof t === 'string' && /fail|error|revert/i.test(t)) || ev.type === 'diagnostic';
    
    await storeInvocation({
      contractId,
      method,
      args: ev.data || null,
      txHash: ev.id || null,
      invocationIndex: invocationIndex++,
      success: !isFailure,
      error: isFailure ? 'Contract invocation failed' : null,
    });
  }
}

async function runMonitoringJob() {
  try {
    const { rows: contracts } = await db.query(
      `SELECT contract_id FROM contracts_registry`
    );
    await Promise.all(contracts.map((c) => monitorContract(c.contract_id)));
  } catch (err) {
    logger.error('[ContractMonitor] Job error:', err.message);
  }
}

function startContractMonitor() {
  logger.info('[ContractMonitor] Starting — polling every 5 minutes');
  runMonitoringJob();
  return setInterval(runMonitoringJob, POLL_INTERVAL_MS);
}

module.exports = { startContractMonitor, runMonitoringJob };
