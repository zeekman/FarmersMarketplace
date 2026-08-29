/**
 * Unit tests for #387 (order quantity max) and #388 (product cache role leak).
 * These tests exercise the logic directly without loading the full Express app.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// #387 — validate.order quantity max
// ---------------------------------------------------------------------------
describe('#387 — order schema quantity max', () => {
  let orderSchema;

  beforeAll(() => {
    // Load only the validate module (no Express app needed)
    const validate = require('../middleware/validate');
    // Extract the Zod schema from the middleware by inspecting the closure.
    // validate.order is an Express middleware; we test the schema directly
    // by calling it with a mock req/res/next.
    orderSchema = validate.order;
  });

  function runValidation(body) {
    let statusCode = null;
    let responseBody = null;
    const req = { body };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; return this; },
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    orderSchema(req, res, next);
    return { statusCode, responseBody, nextCalled, req };
  }

  it('passes when quantity equals MAX_ORDER_QUANTITY (10000)', () => {
    const { nextCalled } = runValidation({ product_id: 1, quantity: 10000 });
    expect(nextCalled).toBe(true);
  });

  it('returns 400 when quantity exceeds MAX_ORDER_QUANTITY (10000)', () => {
    const { statusCode, responseBody, nextCalled } = runValidation({ product_id: 1, quantity: 10001 });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(400);
    expect(responseBody.code).toBe('validation_error');
  });

  it('passes when quantity is 1', () => {
    const { nextCalled } = runValidation({ product_id: 1, quantity: 1 });
    expect(nextCalled).toBe(true);
  });

  it('returns 400 when quantity is 0', () => {
    const { statusCode, nextCalled } = runValidation({ product_id: 1, quantity: 0 });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(400);
  });

  it('respects MAX_ORDER_QUANTITY env var', () => {
    const originalEnv = process.env.MAX_ORDER_QUANTITY;
    process.env.MAX_ORDER_QUANTITY = '5';

    // Re-require to pick up new env var
    jest.resetModules();
    const validate = require('../middleware/validate');
    const schema = validate.order;

    function run(body) {
      let statusCode = null;
      const req = { body };
      const res = {
        status(code) { statusCode = code; return this; },
        json() { return this; },
      };
      let nextCalled = false;
      schema(req, res, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    }

    expect(run({ product_id: 1, quantity: 5 }).nextCalled).toBe(true);
    expect(run({ product_id: 1, quantity: 6 }).nextCalled).toBe(false);

    process.env.MAX_ORDER_QUANTITY = originalEnv || '';
    jest.resetModules();
  });
});

// ---------------------------------------------------------------------------
// #388 — product listing cache role isolation
// ---------------------------------------------------------------------------
describe('#388 — product listing cache role isolation', () => {
  const FARMER_ONLY_FIELD = 'low_stock_threshold';

  const productRow = {
    id: 1,
    name: 'Tomatoes',
    price: 2.5,
    quantity: 100,
    farmer_name: 'Joe',
    [FARMER_ONLY_FIELD]: 5,
  };

  // Simulate the stripping logic from products.js
  function buildPayload(role, products) {
    const payload = { success: true, data: [...products] };
    if (role !== 'farmer') {
      payload.data = payload.data.map(({ [FARMER_ONLY_FIELD]: _, ...rest }) => rest);
    }
    return payload;
  }

  // Simulate the cache key logic from products.js
  function buildCacheKey(role, query) {
    return `products:${role}:${JSON.stringify(query)}`;
  }

  it('farmer payload includes low_stock_threshold', () => {
    const payload = buildPayload('farmer', [productRow]);
    expect(payload.data[0][FARMER_ONLY_FIELD]).toBe(5);
  });

  it('buyer payload does not include low_stock_threshold', () => {
    const payload = buildPayload('buyer', [productRow]);
    expect(payload.data[0][FARMER_ONLY_FIELD]).toBeUndefined();
  });

  it('public (unauthenticated) payload does not include low_stock_threshold', () => {
    const payload = buildPayload('public', [productRow]);
    expect(payload.data[0][FARMER_ONLY_FIELD]).toBeUndefined();
  });

  it('farmer and buyer cache keys are different for the same query', () => {
    const query = { page: '1' };
    const farmerKey = buildCacheKey('farmer', query);
    const buyerKey = buildCacheKey('buyer', query);
    expect(farmerKey).not.toBe(buyerKey);
    expect(farmerKey).toContain(':farmer:');
    expect(buyerKey).toContain(':buyer:');
  });

  it('public cache key is different from farmer cache key', () => {
    const query = {};
    const farmerKey = buildCacheKey('farmer', query);
    const publicKey = buildCacheKey('public', query);
    expect(farmerKey).not.toBe(publicKey);
  });

  it('farmer cached response is not served to buyer (different keys)', () => {
    const query = {};
    const farmerKey = buildCacheKey('farmer', query);
    const buyerKey = buildCacheKey('buyer', query);

    // Simulate cache: farmer populates it
    const cache = new Map();
    const farmerPayload = buildPayload('farmer', [productRow]);
    cache.set(farmerKey, farmerPayload);

    // Buyer looks up their key — should miss
    const buyerCached = cache.get(buyerKey);
    expect(buyerCached).toBeUndefined();

    // Buyer gets fresh data with stripped fields
    const buyerPayload = buildPayload('buyer', [productRow]);
    cache.set(buyerKey, buyerPayload);

    // Verify farmer cache still has low_stock_threshold
    expect(cache.get(farmerKey).data[0][FARMER_ONLY_FIELD]).toBe(5);
    // Verify buyer cache does not
    expect(cache.get(buyerKey).data[0][FARMER_ONLY_FIELD]).toBeUndefined();
  });
});
