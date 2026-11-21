'use strict';
const db = require('../db/schema');
const config = require('../config');
const logger = require('../logger');
const contractClient = require('../utils/stellar-contracts');
const { sendPushToUser } = require('../utils/pushNotifications');

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_RUNTIME_MS = 45_000;
const MAX_RUNTIME_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_BASE_MS = 60 * 60 * 1000;
const DEFAULT_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

function positiveInt(value, fallback, ceiling = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : fallback;
}
function knownContractError(error) {
  const text = [error?.code, error?.message, error?.toString?.()].filter(Boolean).join(' ');
  const lower = text.toLowerCase();
  const contractError = text.match(/error\(contract,\s*#(\d+)\)/i);
  const code = contractError ? Number(contractError[1]) : Number(error?.code);
  if (/timeouts?notreached|timeout not reached/.test(lower) || code === 7) return 'TimeoutNotReached';
  if (/alreadysettled|already settled/.test(lower) || code === 2) return 'AlreadySettled';
  if (/indispute|in dispute/.test(lower) || code === 3) return 'InDispute';
  return null;
}
function backoffMs(attempts, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, Math.min(attempts - 1, 20))));
}
async function fetchDueOrders(database, nowUnix, batchSize) {
  const { rows } = await database.query(
    `SELECT o.id, o.buyer_id, p.farmer_id, o.timeout_refund_attempts
       FROM orders o
       JOIN products p ON p.id = o.product_id
      WHERE o.escrow_balance_id LIKE 'soroban:%'
        AND o.escrow_status = 'funded'
        AND o.timeout_unix IS NOT NULL
        AND o.timeout_unix < $1
        AND (o.timeout_refund_retry_at IS NULL OR o.timeout_refund_retry_at <= $1)
      ORDER BY o.timeout_unix ASC, o.id ASC
      LIMIT $2`,
    [nowUnix, batchSize]
  );
  return rows;
}
async function recordRetry(database, order, nowUnix, baseMs, maxMs) {
  const attempts = Number(order.timeout_refund_attempts || 0) + 1;
  const retryAt = nowUnix + Math.ceil(backoffMs(attempts, baseMs, maxMs) / 1000);
  await database.query(
    `UPDATE orders
        SET timeout_refund_attempts = $1, timeout_refund_retry_at = $2
      WHERE id = $3 AND escrow_status = 'funded'`,
    [attempts, retryAt, order.id]
  );
  return { attempts, retryAt };
}
async function markKnownOutcome(database, orderId, outcome) {
  const escrowStatus = outcome === 'AlreadySettled' ? 'settled' : 'disputed';
  await database.query(
    `UPDATE orders
        SET escrow_status = $1, timeout_refund_retry_at = NULL
      WHERE id = $2 AND escrow_status = 'funded'`,
    [escrowStatus, orderId]
  );
}
async function notifyParties(notifier, order, txHash, log) {
  const title = 'Escrow timeout refund claimed';
  const buyerBody = `The escrow for order #${order.id} was refunded after its timeout.`;
  const farmerBody = `The escrow for order #${order.id} was refunded to the buyer after its timeout.`;
  for (const [userId, body, role] of [
    [order.buyer_id, buyerBody, 'buyer'],
    [order.farmer_id, farmerBody, 'farmer'],
  ]) {
    if (userId == null) continue;
    try {
      await notifier(userId, { title, body, url: `/orders/${order.id}`, txHash });
    } catch (error) {
      log.warn('[timeoutRefunds] Refund notification failed', {
        orderId: order.id,
        userId,
        role,
        error: error.message,
      });
    }
  }
}
/**
 * Process one bounded pass of expired Soroban escrows.
 * All collaborators are injectable so this job can be tested without RPC, push, or a database.
 */
async function runTimeoutRefunds({
  database = db,
  client = contractClient,
  signerSecret = config.platformFeeAccountSecret,
  notifier = sendPushToUser,
  log = logger,
  now = () => Math.floor(Date.now() / 1000),
  batchSize = positiveInt(process.env.TIMEOUT_REFUND_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
  maxRuntimeMs = positiveInt(process.env.TIMEOUT_REFUND_MAX_RUNTIME_MS, DEFAULT_MAX_RUNTIME_MS, MAX_RUNTIME_MS),
  retryBaseMs = positiveInt(process.env.TIMEOUT_REFUND_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS),
  retryMaxMs = positiveInt(process.env.TIMEOUT_REFUND_RETRY_MAX_MS, DEFAULT_RETRY_MAX_MS),
} = {}) {
  if (!signerSecret) throw new Error('PLATFORM_FEE_ACCOUNT_SECRET is required for timeout escrow refunds');
  const startTime = Date.now();
  const nowUnix = now();
  const dueOrders = await fetchDueOrders(database, nowUnix, positiveInt(batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
  let refunded = 0;
  let deferred = 0;
  let handled = 0;
  for (const order of dueOrders) {
    if (Date.now() - startTime >= maxRuntimeMs) break;
    handled += 1;
    try {
      const result = await client.claimTimeoutRefund({ orderId: Number(order.id), signerSecret });
      const txHash = result?.txHash || result?.hash || null;
      if (!txHash) throw new Error('Timeout refund contract call returned no transaction hash');
      const update = await database.query(
        `UPDATE orders
            SET status = 'refunded', escrow_status = 'refunded', settlement_tx_hash = $1,
                timeout_refund_attempts = 0, timeout_refund_retry_at = NULL
          WHERE id = $2 AND escrow_status = 'funded'`,
        [txHash, order.id]
      );
      if (update.rowCount !== 0) {
        refunded += 1;
        log.info('[timeoutRefunds] Timeout refund confirmed', { orderId: order.id, txHash });
        await notifyParties(notifier, order, txHash, log);
      }
    } catch (error) {
      const known = knownContractError(error);
      if (known === 'AlreadySettled' || known === 'InDispute') {
        await markKnownOutcome(database, order.id, known);
        log.info('[timeoutRefunds] Escrow is no longer claimable; marked idempotently', {
          orderId: order.id,
          outcome: known,
        });
        deferred += 1;
        continue;
      }
      const retry = await recordRetry(database, order, nowUnix, retryBaseMs, retryMaxMs);
      if (known === 'TimeoutNotReached') {
        log.info('[timeoutRefunds] Contract timeout has not elapsed yet; retry deferred', {
          orderId: order.id,
          retryAt: retry.retryAt,
          attempts: retry.attempts,
        });
      } else {
        log.warn('[timeoutRefunds] Refund failed; retry scheduled with backoff', {
          orderId: order.id,
          retryAt: retry.retryAt,
          attempts: retry.attempts,
          error: error.message,
        });
      }
      deferred += 1;
    }
  }
  const result = { selected: dueOrders.length, handled, refunded, deferred, timedOut: handled < dueOrders.length };
  log.info('[timeoutRefunds] Pass finished', { ...result, durationMs: Date.now() - startTime });
  return result;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  DEFAULT_MAX_RUNTIME_MS,
  MAX_RUNTIME_MS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  knownContractError,
  backoffMs,
  fetchDueOrders,
  runTimeoutRefunds,
};
