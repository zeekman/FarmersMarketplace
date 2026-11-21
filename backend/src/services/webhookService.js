'use strict';

const crypto = require('crypto');
const logger = require('../logger');
const defaultDb = require('../db/schema');

const SUPPORTED_EVENTS = ['order.paid', 'order.shipped', 'order.delivered', 'order.cancelled', 'order.refunded'];
const TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

function signPayload(secret, payload) {
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}
function signWebhookPayload(secret, timestamp, payload) {
  return `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
}
function buildPayload(event, order) {
  return JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: {
      order_id: order.id,
      status: order.status,
      buyer_id: order.buyer_id,
      farmer_id: order.farmer_id,
      total_amount: order.total_amount ?? order.total_price,
      currency: order.currency || 'USD',
      updated_at: order.updated_at || order.created_at,
    },
  });
}
function shouldRetry(result) {
  return result.status == null || result.status === 429 || result.status >= 500;
}
async function deliverWebhook(url, secret, payload, { webhookId = crypto.randomUUID(), timestamp = Date.now(), attempt = 1 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Id': webhookId,
        'X-Webhook-Timestamp': String(timestamp),
        'X-Webhook-Signature': signWebhookPayload(secret, timestamp, payload),
        'X-Farmers-Signature': signPayload(secret, payload),
        'X-Farmers-Event-Attempt': String(attempt),
        'User-Agent': 'FarmersMarketplace-Webhook/1.0',
      },
      body: payload,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, body: await res.text().catch(() => '') };
  } catch (err) {
    return { ok: false, status: null, body: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function enqueueOrderWebhook(db, event, order) {
  if (!SUPPORTED_EVENTS.includes(event)) return null;
  const { rows } = await db.query(
    `SELECT u.webhook_url, u.webhook_secret
       FROM users u JOIN products p ON p.farmer_id = u.id
      WHERE u.id = $1 AND p.id = $2`,
    [order.farmer_id, order.product_id]
  );
  const farmer = rows[0];
  if (!farmer?.webhook_url || !farmer?.webhook_secret) return null;
  const result = await db.query(
    `INSERT INTO webhook_deliveries
       (order_id, event, url, secret, webhook_id, webhook_timestamp, attempt, status, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'pending', CURRENT_TIMESTAMP)
     RETURNING id`,
    [order.id, event, farmer.webhook_url, farmer.webhook_secret, crypto.randomUUID(), Date.now()]
  );
  return result.rows?.[0]?.id || null;
}

async function processWebhookDeliveries({ db = defaultDb, limit = 25 } = {}) {
  const due = db.isPostgres
    ? '(next_attempt_at IS NULL OR next_attempt_at <= NOW())'
    : '(next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)';
  const { rows } = await db.query(
    `SELECT id FROM webhook_deliveries
      WHERE status = 'pending' AND ${due}
      ORDER BY id ASC LIMIT $1`,
    [Math.max(1, Math.min(100, limit))]
  );
  for (const candidate of rows) {
    const claim = await db.query(
      `UPDATE webhook_deliveries SET status = 'processing'
        WHERE id = $1 AND status = 'pending'`,
      [candidate.id]
    );
    if (claim.rowCount !== 1) continue;
    try {
      const { rows: deliveries } = await db.query(
        `SELECT d.*, o.status AS order_status, o.buyer_id, o.total_price,
                o.created_at AS order_created_at, p.farmer_id
           FROM webhook_deliveries d
           JOIN orders o ON o.id = d.order_id
           JOIN products p ON p.id = o.product_id
          WHERE d.id = $1`,
        [candidate.id]
      );
      const delivery = deliveries[0];
      if (!delivery) {
        await db.query("UPDATE webhook_deliveries SET status = 'dead', response_body = $1 WHERE id = $2", ['Order no longer exists', candidate.id]);
        continue;
      }
      const attempt = Number(delivery.attempt || 0) + 1;
      const payload = buildPayload(delivery.event, {
        id: delivery.order_id,
        status: delivery.order_status,
        buyer_id: delivery.buyer_id,
        farmer_id: delivery.farmer_id,
        total_price: delivery.total_price,
        created_at: delivery.order_created_at,
      });
      const result = await deliverWebhook(delivery.url, delivery.secret, payload, {
        webhookId: delivery.webhook_id,
        timestamp: delivery.webhook_timestamp,
        attempt,
      });
      const responseBody = result.body?.slice(0, 1000) || null;
      if (result.ok) {
        await db.query(
          `UPDATE webhook_deliveries
              SET status = 'delivered', attempt = $1, status_code = $2, success = $3,
                  response_body = $4, delivered_at = CURRENT_TIMESTAMP,
                  next_attempt_at = NULL, payload = $5 WHERE id = $6`,
          [attempt, result.status, true, responseBody, payload, candidate.id]
        );
      } else if (shouldRetry(result) && attempt <= RETRY_DELAYS_MS.length) {
        const nextAttempt = new Date(Date.now() + RETRY_DELAYS_MS[attempt - 1]).toISOString();
        await db.query(
          `UPDATE webhook_deliveries SET status = 'pending', attempt = $1, status_code = $2,
                  success = $3, response_body = $4, next_attempt_at = $5, payload = $6 WHERE id = $7`,
          [attempt, result.status, false, responseBody, nextAttempt, payload, candidate.id]
        );
      } else {
        await db.query(
          `UPDATE webhook_deliveries SET status = 'dead', attempt = $1, status_code = $2,
                  success = $3, response_body = $4, next_attempt_at = NULL, payload = $5 WHERE id = $6`,
          [attempt, result.status, false, responseBody, payload, candidate.id]
        );
      }
    } catch (error) {
      logger.error('[webhook] Delivery worker failed', { deliveryId: candidate.id, error: error.message });
      await db.query(
        `UPDATE webhook_deliveries SET status = 'pending', response_body = $1, next_attempt_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [error.message.slice(0, 1000), candidate.id]
      );
    }
  }
}

// Compatibility name: this now queues work and never performs network I/O inline.
async function fireOrderWebhook(db, event, order) {
  return enqueueOrderWebhook(db, event, order);
}

module.exports = {
  fireOrderWebhook,
  enqueueOrderWebhook,
  processWebhookDeliveries,
  deliverWebhook,
  buildPayload,
  signPayload,
  signWebhookPayload,
  shouldRetry,
  SUPPORTED_EVENTS,
  RETRY_DELAYS_MS,
};
