/**
 * webhook.test.js  (#1144)
 *
 * Unit tests for:
 *   - backend/src/services/webhookService.js
 *   - backend/src/services/webhookVerify.js
 *
 * Covers:
 *   webhookVerify: valid signature accepted, forged signature rejected,
 *     missing signature header rejected, stale/replayed request rejected,
 *     timingSafeEqual is used (not plain ===).
 *   webhookService: signPayload, buildPayload, fireOrderWebhook retry/delivery
 *     recording, unsupported events skipped, missing webhook config skipped.
 */

'use strict';

const crypto = require('crypto');

// ─── webhookVerify ──────────────────────────────────────────────────────────

describe('webhookVerify', () => {
  let verifyWebhookSignature;
  let webhookMiddleware;

  beforeEach(() => {
    jest.resetModules();
    ({ verifyWebhookSignature, webhookMiddleware } = require('../services/webhookVerify'));
  });

  // ── verifyWebhookSignature ─────────────────────────────────────────────────

  describe('verifyWebhookSignature()', () => {
    const SECRET = 'super-secret-key';

    function makeSignature(secret, body) {
      return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    it('returns true for a valid HMAC signature', () => {
      const body = '{"event":"order.paid"}';
      const sig = makeSignature(SECRET, body);
      expect(verifyWebhookSignature(SECRET, body, sig)).toBe(true);
    });

    it('returns false for a forged / wrong signature', () => {
      const body = '{"event":"order.paid"}';
      const badSig = makeSignature('wrong-secret', body);
      expect(verifyWebhookSignature(SECRET, body, badSig)).toBe(false);
    });

    it('returns false when signature header is missing (undefined)', () => {
      expect(verifyWebhookSignature(SECRET, 'body', undefined)).toBe(false);
    });

    it('returns false when signature header is null', () => {
      expect(verifyWebhookSignature(SECRET, 'body', null)).toBe(false);
    });

    it('returns false when signature does not start with sha256=', () => {
      const body = 'data';
      const noPrefix = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
      expect(verifyWebhookSignature(SECRET, body, noPrefix)).toBe(false);
    });

    it('returns false for a valid-looking but truncated signature', () => {
      const body = 'data';
      const sig = makeSignature(SECRET, body);
      const truncated = sig.slice(0, -4); // chop last 4 chars
      expect(verifyWebhookSignature(SECRET, body, truncated)).toBe(false);
    });

    it('returns false when body content has been tampered', () => {
      const originalBody = '{"event":"order.paid","amount":100}';
      const sig = makeSignature(SECRET, originalBody);
      const tamperedBody = '{"event":"order.paid","amount":999}';
      expect(verifyWebhookSignature(SECRET, tamperedBody, sig)).toBe(false);
    });

    it('uses timingSafeEqual — not a plain string === comparison', () => {
      // If the implementation were using ===, replacing timingSafeEqual with a
      // spy that throws should cause verify to fail, not bypass it.
      const cryptoModule = require('crypto');
      const spy = jest.spyOn(cryptoModule, 'timingSafeEqual');
      const body = 'test-body';
      const sig = makeSignature(SECRET, body);
      verifyWebhookSignature(SECRET, body, sig);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ── webhookMiddleware factory ──────────────────────────────────────────────

  describe('webhookMiddleware()', () => {
    const SECRET = 'middleware-secret';

    function makeSignature(secret, body) {
      return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    function makeReq({ body = '{}', signature, timestamp, rawBody } = {}) {
      return {
        headers: {
          ...(signature !== undefined && { 'x-webhook-signature': signature }),
          ...(timestamp !== undefined && { 'x-webhook-timestamp': String(timestamp) }),
        },
        rawBody,
        body: JSON.parse(body),
      };
    }

    function makeRes() {
      const res = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res;
    }

    it('calls next() when signature is valid and no timestamp is provided', async () => {
      const body = '{"order_id":1}';
      const sig = makeSignature(SECRET, body);
      const req = makeReq({ body, signature: sig, rawBody: body });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 401 when signature header is missing', async () => {
      const req = makeReq({ body: '{}' }); // no signature
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_signature' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when signature is wrong (forged)', async () => {
      const body = '{"order_id":2}';
      const badSig = makeSignature('wrong-secret', body);
      const req = makeReq({ body, signature: badSig, rawBody: body });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 for a stale/replayed request (timestamp too old)', async () => {
      const body = '{"order_id":3}';
      const sig = makeSignature(SECRET, body);
      const staleTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago — beyond 5 min window
      const req = makeReq({ body, signature: sig, rawBody: body, timestamp: staleTimestamp });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'replay_detected' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 for a future timestamp beyond the replay window', async () => {
      const body = '{"order_id":4}';
      const sig = makeSignature(SECRET, body);
      const futureTimestamp = Date.now() + 10 * 60 * 1000; // 10 minutes in future
      const req = makeReq({ body, signature: sig, rawBody: body, timestamp: futureTimestamp });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts a request with a fresh timestamp inside the replay window', async () => {
      const body = '{"order_id":5}';
      const sig = makeSignature(SECRET, body);
      const freshTimestamp = Date.now() - 60 * 1000; // 1 minute ago
      const req = makeReq({ body, signature: sig, rawBody: body, timestamp: freshTimestamp });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when getSecret() returns null (no configured secret)', async () => {
      const body = '{}';
      const sig = makeSignature(SECRET, body);
      const req = makeReq({ body, signature: sig, rawBody: body });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(null);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 500 when getSecret() throws', async () => {
      const body = '{}';
      const sig = makeSignature(SECRET, body);
      const req = makeReq({ body, signature: sig, rawBody: body });
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockRejectedValue(new Error('DB error'));

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });

    it('falls back to JSON.stringify(req.body) when rawBody is absent', async () => {
      const bodyObj = { order_id: 6 };
      const serialized = JSON.stringify(bodyObj);
      const sig = makeSignature(SECRET, serialized);
      // No rawBody provided — middleware must serialise req.body itself
      const req = {
        headers: { 'x-webhook-signature': sig },
        body: bodyObj,
      };
      const res = makeRes();
      const next = jest.fn();
      const getSecret = jest.fn().mockResolvedValue(SECRET);

      const mw = webhookMiddleware(getSecret);
      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});

// ─── webhookService ──────────────────────────────────────────────────────────

describe('webhookService', () => {
  let webhookService;
  let globalFetch;

  beforeEach(() => {
    jest.resetModules();
    // Capture any existing global fetch, then replace with a jest mock
    globalFetch = global.fetch;
    global.fetch = jest.fn();
    webhookService = require('../services/webhookService');
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  // ── signPayload ────────────────────────────────────────────────────────────

  describe('signPayload()', () => {
    it('returns sha256=<hex> HMAC over the payload', () => {
      const { signPayload } = webhookService;
      const secret = 'my-secret';
      const payload = '{"event":"order.paid"}';
      const expected =
        'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(signPayload(secret, payload)).toBe(expected);
    });

    it('produces different signatures for different secrets', () => {
      const { signPayload } = webhookService;
      const payload = 'same-payload';
      expect(signPayload('secret-a', payload)).not.toBe(signPayload('secret-b', payload));
    });

    it('produces different signatures for different payloads', () => {
      const { signPayload } = webhookService;
      const secret = 'shared-secret';
      expect(signPayload(secret, 'payload-1')).not.toBe(signPayload(secret, 'payload-2'));
    });
  });

  // ── SUPPORTED_EVENTS ──────────────────────────────────────────────────────

  describe('SUPPORTED_EVENTS', () => {
    it('exports the supported event list', () => {
      const { SUPPORTED_EVENTS } = webhookService;
      expect(Array.isArray(SUPPORTED_EVENTS)).toBe(true);
      expect(SUPPORTED_EVENTS).toContain('order.paid');
    });
  });

  // ── fireOrderWebhook ──────────────────────────────────────────────────────

  describe('fireOrderWebhook()', () => {
    const mockOrder = {
      id: 42,
      status: 'paid',
      buyer_id: 1,
      farmer_id: 7,
      total_amount: '50.00',
      currency: 'USD',
      updated_at: new Date().toISOString(),
    };

    function makeDb({ webhookUrl = 'https://example.com/hook', webhookSecret = 'farmer-secret' } = {}) {
      const insertFn = jest.fn().mockResolvedValue([]);
      const whereFn = jest.fn().mockReturnThis();
      const firstFn = jest.fn().mockResolvedValue({
        id: 7,
        webhook_url: webhookUrl,
        webhook_secret: webhookSecret,
      });
      const dbFn = jest.fn().mockReturnValue({
        where: whereFn,
        first: firstFn,
        insert: insertFn,
      });
      // Allow chained calls for webhook_deliveries.insert
      dbFn.mockImplementation((table) => {
        if (table === 'webhook_deliveries') return { insert: insertFn };
        return { where: whereFn, first: firstFn };
      });
      return { db: dbFn, insertFn };
    }

    it('skips delivery for unsupported events', async () => {
      const { db } = makeDb();
      global.fetch = jest.fn();
      await webhookService.fireOrderWebhook(db, 'order.unknown', mockOrder);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('skips delivery when farmer has no webhook_url', async () => {
      const dbFn = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({ id: 7, webhook_url: null, webhook_secret: null }),
      });
      global.fetch = jest.fn();
      await webhookService.fireOrderWebhook(dbFn, 'order.paid', mockOrder);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('skips delivery when farmer row is not found', async () => {
      const dbFn = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null),
      });
      global.fetch = jest.fn();
      await webhookService.fireOrderWebhook(dbFn, 'order.paid', mockOrder);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('delivers the webhook and records success on 200 OK', async () => {
      const { db, insertFn } = makeDb();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('OK'),
      });

      await webhookService.fireOrderWebhook(db, 'order.paid', mockOrder);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('https://example.com/hook');
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-Farmers-Signature']).toMatch(/^sha256=/);
      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, attempt: 1 })
      );
    });

    it('retries on failure and records each attempt', async () => {
      jest.useFakeTimers();
      const { db, insertFn } = makeDb();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue('error'),
      });

      const promise = webhookService.fireOrderWebhook(db, 'order.paid', mockOrder);
      // Advance timers to bypass retry delays (1000ms * attempt)
      await jest.runAllTimersAsync();
      await promise;

      // 3 attempts (MAX_RETRIES = 3)
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(insertFn).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });

    it('stops retrying after first success', async () => {
      jest.useFakeTimers();
      const { db, insertFn } = makeDb();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: jest.fn().mockResolvedValue('err') })
        .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue('ok') });

      const promise = webhookService.fireOrderWebhook(db, 'order.paid', mockOrder);
      await jest.runAllTimersAsync();
      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('includes X-Farmers-Event-Attempt header matching the attempt number', async () => {
      jest.useFakeTimers();
      const { db } = makeDb();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: jest.fn().mockResolvedValue('') })
        .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue('') });

      const promise = webhookService.fireOrderWebhook(db, 'order.paid', mockOrder);
      await jest.runAllTimersAsync();
      await promise;

      expect(global.fetch.mock.calls[0][1].headers['X-Farmers-Event-Attempt']).toBe('1');
      expect(global.fetch.mock.calls[1][1].headers['X-Farmers-Event-Attempt']).toBe('2');
      jest.useRealTimers();
    });

    it('handles a fetch network error gracefully (records failure, no throw)', async () => {
      jest.useFakeTimers();
      const { db, insertFn } = makeDb();
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

      const promise = webhookService.fireOrderWebhook(db, 'order.paid', mockOrder);
      await jest.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();

      expect(insertFn).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });
  });
});
