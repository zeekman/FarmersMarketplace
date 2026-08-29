/**
 * jobs/contractMonitor.js
 *
 * Records an audit row in contract_invocations for every Soroban contract call the
 * backend makes (escrow deposit/release/refund/dispute, carbon offset, reward mints).
 *
 * The `args` column is capped at ARGS_LIMIT characters (see migration
 * 014_contract_invocations_args_limit.sql). Serialized args longer than that are
 * truncated before INSERT — relying on the DB CHECK constraint to reject the row
 * would silently drop the whole audit record instead of just the oversized field.
 */

const db = require('../db/schema');
const logger = require('../logger');

const ARGS_LIMIT = 4000;

function serializeArgs(args) {
  if (args === undefined || args === null) return null;
  return typeof args === 'string' ? args : JSON.stringify(args);
}

function truncateArgs(serialized, contractId) {
  if (serialized === null || serialized.length <= ARGS_LIMIT) return serialized;

  logger.warn('[contractMonitor] Truncating oversized contract invocation args', {
    contractId,
    originalSize: serialized.length,
    limit: ARGS_LIMIT,
  });

  return serialized.slice(0, ARGS_LIMIT);
}

/**
 * Log a contract invocation. Call this alongside (not instead of) the actual
 * on-chain call — this is an audit trail, not the source of truth for tx state.
 */
async function recordContractInvocation({ contractId, action, args, txHash, status = 'success' }) {
  const serialized = truncateArgs(serializeArgs(args), contractId);

  await db.query(
    'INSERT INTO contract_invocations (contract_id, action, args, tx_hash, status) VALUES ($1, $2, $3, $4, $5)',
    [contractId, action, serialized, txHash || null, status]
  );
}

module.exports = { recordContractInvocation, ARGS_LIMIT };
 * jobs/contractMonitor.js — Issue #862
 *
 * Subscribes to Soroban contract events for the configured escrow contract and
 * updates order records in the database based on the event type:
 *
 *   deposit  → orders.escrow_status = 'active'
 *   release  → orders.escrow_status = 'released', orders.status = 'paid', notify buyer
 *   refund   → orders.escrow_status = 'refunded', notify buyer
 *   dispute  → orders.escrow_status = 'disputed'
 *
 * Resume behaviour:
 *   The last processed ledger is persisted in `escrow_monitor_cursor`.
 *   On restart the monitor resumes polling from that ledger + 1 so no events
 *   are re-processed or skipped.
 *
 * Retry:
 *   Exponential backoff up to MAX_BACKOFF_MS (60 s) on RPC failures.
 *   After MAX_RETRIES consecutive failures an admin alert email is sent.
 */

'use strict';

const db = require('../db/schema');
const { getContractEvents } = require('../utils/stellar');
const { sendStatusUpdateEmail } = require('../utils/mailer');
const { sendPushToUser } = require('../utils/pushNotifications');
const logger = require('../logger');
const config = require('../config');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60 * 1000; // 60 s
const ARGS_MAX_BYTES = 65535;

// ── helpers ──────────────────────────────────────────────────────────────────

function truncateArgs(args) {
  if (args == null) return null;
  const json = JSON.stringify(args);
  if (Buffer.byteLength(json, 'utf8') <= ARGS_MAX_BYTES) return json;
  const marker = '... (truncated)';
  const limit = ARGS_MAX_BYTES - Buffer.byteLength(marker, 'utf8');
  let t = json;
  while (Buffer.byteLength(t, 'utf8') > limit) t = t.slice(0, -1);
  return t + marker;
}

async function storeInvocation({ contractId, method, args, txHash, invocationIndex, success, error }) {
  try {
    const truncatedArgs = truncateArgs(args);
    await db.query(
      `INSERT INTO contract_invocations
         (contract_id, method, args, tx_hash, invocation_index, success, error, invoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (tx_hash, invocation_index) DO NOTHING`,
      [contractId, method, truncatedArgs, txHash || null, invocationIndex, success ? 1 : 0, error || null]
    );
  } catch (err) {
    logger.error('[ContractMonitor] Failed to store invocation:', err.message);
  }
}

// ── cursor persistence ────────────────────────────────────────────────────────

async function getLastLedger(contractId) {
  try {
    const { rows } = await db.query(
      `SELECT last_ledger FROM escrow_monitor_cursor WHERE contract_id = $1`,
      [contractId]
    );
    return rows[0] ? Number(rows[0].last_ledger) : 0;
  } catch {
    return 0;
  }
}

async function saveLastLedger(contractId, ledger) {
  try {
    await db.query(
      `INSERT INTO escrow_monitor_cursor (contract_id, last_ledger, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (contract_id) DO UPDATE
         SET last_ledger = EXCLUDED.last_ledger,
             updated_at  = CURRENT_TIMESTAMP`,
      [contractId, ledger]
    );
  } catch (err) {
    logger.warn('[ContractMonitor] Could not persist cursor:', err.message);
  }
}

// ── event handlers ────────────────────────────────────────────────────────────

/**
 * Extracts the numeric order_id from the event topics array.
 * Escrow events use topic[2] as the order_id (e.g. ["escrow","deposit",<order_id>]).
 */
function extractOrderId(topics) {
  const raw = topics[2];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function handleDeposit(contractId, topics, data, txHash) {
  const orderId = extractOrderId(topics);
  if (!orderId) return;

  logger.info(`[ContractMonitor] deposit event — order #${orderId}`);

  await db.query(
    `UPDATE orders SET escrow_status = 'active' WHERE id = $1`,
    [orderId]
  ).catch((e) => logger.error('[ContractMonitor] deposit DB update failed:', e.message));

  await storeInvocation({ contractId, method: 'deposit', args: data, txHash, invocationIndex: 0, success: true, error: null });
}

async function handleRelease(contractId, topics, data, txHash) {
  const orderId = extractOrderId(topics);
  if (!orderId) return;

  logger.info(`[ContractMonitor] release event — order #${orderId}`);

  await db.query(
    `UPDATE orders SET escrow_status = 'released', status = 'paid' WHERE id = $1`,
    [orderId]
  ).catch((e) => logger.error('[ContractMonitor] release DB update failed:', e.message));

  // Notify buyer
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.total_price, u.email, u.name, p.name AS product_name
       FROM orders o
       JOIN users u ON u.id = o.buyer_id
       JOIN products p ON p.id = o.product_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (rows[0]) {
      const order = rows[0];
      await sendStatusUpdateEmail({ order, newStatus: 'paid', recipientEmail: order.email, recipientName: order.name })
        .catch((e) => logger.warn('[ContractMonitor] release email failed (non-fatal):', e.message));
      await sendPushToUser(order.buyer_id, {
        title: 'Payment Released',
        body: `Your escrow for order #${orderId} has been released.`,
      }).catch(() => {});
    }
  } catch (e) {
    logger.warn('[ContractMonitor] release notification failed (non-fatal):', e.message);
  }

  await storeInvocation({ contractId, method: 'release', args: data, txHash, invocationIndex: 0, success: true, error: null });
}

async function handleRefund(contractId, topics, data, txHash) {
  const orderId = extractOrderId(topics);
  if (!orderId) return;

  logger.info(`[ContractMonitor] refund event — order #${orderId}`);

  await db.query(
    `UPDATE orders SET escrow_status = 'refunded' WHERE id = $1`,
    [orderId]
  ).catch((e) => logger.error('[ContractMonitor] refund DB update failed:', e.message));

  // Notify buyer
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.total_price, u.email, u.name, u.id AS buyer_id
       FROM orders o
       JOIN users u ON u.id = o.buyer_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (rows[0]) {
      const order = rows[0];
      await sendStatusUpdateEmail({ order, newStatus: 'refunded', recipientEmail: order.email, recipientName: order.name })
        .catch((e) => logger.warn('[ContractMonitor] refund email failed (non-fatal):', e.message));
      await sendPushToUser(order.buyer_id, {
        title: 'Escrow Refunded',
        body: `Your escrow for order #${orderId} has been refunded.`,
      }).catch(() => {});
    }
  } catch (e) {
    logger.warn('[ContractMonitor] refund notification failed (non-fatal):', e.message);
  }

  await storeInvocation({ contractId, method: 'refund', args: data, txHash, invocationIndex: 0, success: true, error: null });
}

async function handleDispute(contractId, topics, data, txHash) {
  const orderId = extractOrderId(topics);
  if (!orderId) return;

  logger.info(`[ContractMonitor] dispute event — order #${orderId}`);

  await db.query(
    `UPDATE orders SET escrow_status = 'disputed' WHERE id = $1`,
    [orderId]
  ).catch((e) => logger.error('[ContractMonitor] dispute DB update failed:', e.message));

  await storeInvocation({ contractId, method: 'dispute', args: data, txHash, invocationIndex: 0, success: true, error: null });
}

// ── dispatch ──────────────────────────────────────────────────────────────────

async function dispatchEvent(contractId, ev) {
  const topics = ev.topics || [];
  // Escrow events use topic[0] = 'escrow', topic[1] = action
  if (String(topics[0]) !== 'escrow') return;
  const action = String(topics[1] || '');
  const txHash = ev.id || null;

  switch (action) {
    case 'deposit': return handleDeposit(contractId, topics, ev.data, txHash);
    case 'release': return handleRelease(contractId, topics, ev.data, txHash);
    case 'refund':  return handleRefund(contractId, topics, ev.data, txHash);
    case 'dispute': return handleDispute(contractId, topics, ev.data, txHash);
    default:
      // Store other events without DB side-effects
      await storeInvocation({ contractId, method: action || 'unknown', args: ev.data, txHash, invocationIndex: 0, success: true, error: null });
  }
}

// ── monitor loop ──────────────────────────────────────────────────────────────

async function monitorContract(contractId, retryCount = 0) {
  const lastLedger = await getLastLedger(contractId);

  // Build filter: resume from last processed ledger + 1, or fall back to 1 h ago
  const filters = lastLedger > 0
    ? { fromLedger: lastLedger + 1, limit: 200 }
    : { from: new Date(Date.now() - 60 * 60 * 1000).toISOString(), limit: 200 };

  let result;
  try {
    result = await getContractEvents(contractId, filters);
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const backoffMs = Math.min(Math.pow(2, retryCount) * 1000, MAX_BACKOFF_MS);
      logger.warn(
        `[ContractMonitor] Failed to fetch events for ${contractId}, retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES}):`,
        err.message
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return monitorContract(contractId, retryCount + 1);
    }

    logger.error(`[ContractMonitor] Failed to fetch events for ${contractId} after ${MAX_RETRIES} retries:`, err.message);

    // Send admin alert (non-fatal)
    try {
      const { rows: admins } = await db.query(`SELECT email FROM users WHERE role = 'admin' LIMIT 1`);
      if (admins[0]) {
        const { sendContractAlert } = require('../utils/mailer');
        await sendContractAlert({
          to: admins[0].email,
          alert: { alert_type: 'monitor_failure', contract_id: contractId, message: err.message },
        }).catch(() => {});
      }
    } catch { /* non-fatal */ }
    return;
  }

  const events = result.events || [];
  let highestLedger = lastLedger;

  for (const ev of events) {
    await dispatchEvent(contractId, ev);
    if (ev.ledger && Number(ev.ledger) > highestLedger) {
      highestLedger = Number(ev.ledger);
    }
  }

  // Persist cursor only when we actually advanced
  if (highestLedger > lastLedger) {
    await saveLastLedger(contractId, highestLedger);
  }
}

async function runMonitoringJob() {
  // Use the configured escrow contract if no registry is available
  const escrowContractId = config.sorobanEscrowContractId;

  let contracts = [];
  try {
    const { rows } = await db.query(`SELECT contract_id FROM contracts_registry`);
    contracts = rows;
  } catch {
    // table may not exist in all envs — fall back to config
  }

  if (escrowContractId && !contracts.some((c) => c.contract_id === escrowContractId)) {
    contracts.push({ contract_id: escrowContractId });
  }

  await Promise.all(contracts.map((c) => monitorContract(c.contract_id)));
}

function startContractMonitor() {
  logger.info('[ContractMonitor] Starting — polling every 5 minutes');
  runMonitoringJob();
  return setInterval(runMonitoringJob, POLL_INTERVAL_MS);
}

module.exports = {
  startContractMonitor,
  runMonitoringJob,
  // exported for testing
  _handlers: { handleDeposit, handleRelease, handleRefund, handleDispute, dispatchEvent },
  _cursor: { getLastLedger, saveLastLedger },
};
