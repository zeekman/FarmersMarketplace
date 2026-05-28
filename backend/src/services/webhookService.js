const crypto = require("crypto");

const SUPPORTED_EVENTS = ["order.paid", "order.shipped", "order.delivered"];
const TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function signPayload(secret, payload) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
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
      total_amount: order.total_amount,
      currency: order.currency || "USD",
      updated_at: order.updated_at,
    },
  });
}

async function deliverWebhook(url, secret, payload, attempt = 1) {
  const signature = signPayload(secret, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Farmers-Signature": signature,
        "X-Farmers-Event-Attempt": String(attempt),
        "User-Agent": "FarmersMarketplace-Webhook/1.0",
      },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: null, body: err.message };
  }
}

async function fireOrderWebhook(db, event, order) {
  if (!SUPPORTED_EVENTS.includes(event)) return;
  const farmer = await db("farmers").where({ id: order.farmer_id }).first();
  if (!farmer?.webhook_url || !farmer?.webhook_secret) return;
  const payload = buildPayload(event, order);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await deliverWebhook(farmer.webhook_url, farmer.webhook_secret, payload, attempt);
    await db("webhook_deliveries").insert({
      order_id: order.id,
      event,
      url: farmer.webhook_url,
      status_code: result.status,
      success: result.ok,
      response_body: result.body?.slice(0, 1000),
      attempt,
    });
    if (result.ok) return;
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  console.error(`[webhook] All ${MAX_RETRIES} attempts failed for order ${order.id} event ${event}`);
}

module.exports = { fireOrderWebhook, signPayload, SUPPORTED_EVENTS };
