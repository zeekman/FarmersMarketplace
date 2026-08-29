/**
 * jobs/creatorEarningsMonitor.js — Issue #994
 *
 * Subscribes to Soroban contract events for the configured Creator Earnings
 * contract and persists them into `creator_earnings_ledger` so a farmer's
 * earnings history can be read from the database instead of the RPC on
 * every dashboard load.
 *
 *   credit → creator_earnings_ledger row (event_type = 'credit')
 *   claim  → creator_earnings_ledger row (event_type = 'claim')
 *
 * Mirrors jobs/contractMonitor.js:
 *   - Cursor persistence reuses `escrow_monitor_cursor` (keyed by contract_id,
 *     schema is contract-agnostic) so resume-after-restart works the same way.
 *   - Exponential backoff up to MAX_BACKOFF_MS (60 s) on RPC failures, with an
 *     admin alert email after MAX_RETRIES consecutive failures.
 *   - Duplicate events are idempotent: creator_earnings_ledger has a
 *     UNIQUE(tx_hash, event_type, ledger_sequence) constraint, and inserts use
 *     ON CONFLICT DO NOTHING.
 */

'use strict';

const db = require('../db/schema');
const { getContractEvents } = require('../utils/stellar');
const logger = require('../logger');
const config = require('../config');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60 * 1000; // 60 s
const STROOPS_PER_XLM = 10_000_000;

// ── ledger persistence ──────────────────────────────────────────────────────

async function storeEvent({ creatorAddress, amount, feeAmount, txHash, eventType, ledgerSequence }) {
  try {
    await db.query(
      `INSERT INTO creator_earnings_ledger
         (creator_address, amount, fee_amount, tx_hash, event_type, ledger_sequence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tx_hash, event_type, ledger_sequence) DO NOTHING`,
      [creatorAddress, amount, feeAmount, txHash, eventType, ledgerSequence]
    );
  } catch (err) {
    logger.error('[CreatorEarningsMonitor] Failed to store event:', err.message);
  }
}

// ── cursor persistence (shared cursor table — see file header) ─────────────

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
    logger.warn('[CreatorEarningsMonitor] Could not persist cursor:', err.message);
  }
}

// ── event handlers ───────────────────────────────────────────────────────────
// credit data: (creator: Address, farmer_amount: i128, fee_amount: i128)
// claim  data: (creator: Address, amount_claimed: i128)

async function handleCredit(data, txHash, ledgerSequence) {
  if (!Array.isArray(data) || data.length < 3) return;
  const [creatorAddress, farmerAmount, feeAmount] = data;
  if (!creatorAddress) return;

  logger.info(`[CreatorEarningsMonitor] credit event — creator ${creatorAddress}`);

  await storeEvent({
    creatorAddress: String(creatorAddress),
    amount: Number(farmerAmount) / STROOPS_PER_XLM,
    feeAmount: Number(feeAmount) / STROOPS_PER_XLM,
    txHash,
    eventType: 'credit',
    ledgerSequence,
  });
}

async function handleClaim(data, txHash, ledgerSequence) {
  if (!Array.isArray(data) || data.length < 2) return;
  const [creatorAddress, amountClaimed] = data;
  if (!creatorAddress) return;

  logger.info(`[CreatorEarningsMonitor] claim event — creator ${creatorAddress}`);

  await storeEvent({
    creatorAddress: String(creatorAddress),
    amount: Number(amountClaimed) / STROOPS_PER_XLM,
    feeAmount: 0,
    txHash,
    eventType: 'claim',
    ledgerSequence,
  });
}

// ── dispatch ──────────────────────────────────────────────────────────────────

async function dispatchEvent(ev) {
  const topics = ev.topics || [];
  if (String(topics[0]) !== 'creator_earnings') return;
  const action = String(topics[1] || '');
  const txHash = ev.id || null;
  const ledgerSequence = ev.ledger || 0;

  switch (action) {
    case 'credit': return handleCredit(ev.data, txHash, ledgerSequence);
    case 'claim': return handleClaim(ev.data, txHash, ledgerSequence);
    default:
      // upgrade and any future events have no ledger row to persist
      return;
  }
}

// ── monitor loop ──────────────────────────────────────────────────────────────

async function monitorCreatorEarnings(contractId, retryCount = 0) {
  const lastLedger = await getLastLedger(contractId);

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
        `[CreatorEarningsMonitor] Failed to fetch events for ${contractId}, retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES}):`,
        err.message
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return monitorCreatorEarnings(contractId, retryCount + 1);
    }

    logger.error(`[CreatorEarningsMonitor] Failed to fetch events for ${contractId} after ${MAX_RETRIES} retries:`, err.message);

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
    await dispatchEvent(ev);
    if (ev.ledger && Number(ev.ledger) > highestLedger) {
      highestLedger = Number(ev.ledger);
    }
  }

  if (highestLedger > lastLedger) {
    await saveLastLedger(contractId, highestLedger);
  }
}

async function runMonitoringJob() {
  const contractId = config.sorobanCreatorEarningsContractId;
  if (!contractId) return; // Creator Earnings contract not configured in this environment

  await monitorCreatorEarnings(contractId);
}

function startCreatorEarningsMonitor() {
  if (!config.sorobanCreatorEarningsContractId) {
    logger.info('[CreatorEarningsMonitor] SOROBAN_CREATOR_EARNINGS_CONTRACT_ID not set — job disabled');
    return null;
  }
  logger.info('[CreatorEarningsMonitor] Starting — polling every 5 minutes');
  runMonitoringJob();
  return setInterval(runMonitoringJob, POLL_INTERVAL_MS);
}

module.exports = {
  startCreatorEarningsMonitor,
  runMonitoringJob,
  // exported for testing
  _handlers: { handleCredit, handleClaim, dispatchEvent },
  _cursor: { getLastLedger, saveLastLedger },
};
