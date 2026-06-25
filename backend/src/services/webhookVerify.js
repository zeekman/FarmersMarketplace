'use strict';

const crypto = require('crypto');

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function verifyWebhookSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Express middleware factory.
 * Looks up the farmer's webhook_secret by farmer id (passed as req.params.farmerId or
 * via getSecret callback), then verifies signature and timestamp.
 *
 * Usage:
 *   router.post('/webhook', webhookMiddleware(async (req) => secret), handler)
 */
function webhookMiddleware(getSecret) {
  return async (req, res, next) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature', code: 'invalid_signature' });
    }

    // Replay prevention: reject requests older than 5 minutes
    if (timestamp) {
      const ts = Number(timestamp);
      if (isNaN(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
        return res.status(400).json({ error: 'Request timestamp too old or invalid', code: 'replay_detected' });
      }
    }

    let secret;
    try {
      secret = await getSecret(req);
    } catch (e) {
      return res.status(500).json({ error: 'Could not retrieve webhook secret' });
    }

    if (!secret) {
      return res.status(401).json({ error: 'No webhook secret configured', code: 'invalid_signature' });
    }

    const rawBody = req.rawBody || JSON.stringify(req.body);
    if (!verifyWebhookSignature(secret, rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature', code: 'invalid_signature' });
    }

    next();
  };
}

module.exports = { verifyWebhookSignature, webhookMiddleware };
