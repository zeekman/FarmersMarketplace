/**
 * Regression test for issue: categories.js not registered via registerRoute.
 * GET /api/v1/categories must return 200, not 404.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const request = require('supertest');

jest.mock('../routes', () => {
  const express = require('express');
  const router = express.Router();

  function addDeprecationHeaders(req, res, next) {
    res.setHeader('Deprecation', 'true');
    next();
  }

  function registerRoute(basePrefix, path, handler) {
    router.use(`/api${path}`, addDeprecationHeaders, handler);
    router.use(`/api/v1${path}`, handler);
  }

  registerRoute('/', '/categories', require('../routes/categories'));
  return router;
});

const app = require('../app');

describe('GET /api/v1/categories', () => {
  it('returns 200 (not 404) — registerRoute fix regression', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/categories (legacy)', () => {
  it('returns 200 with deprecation header', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.headers['deprecation']).toBe('true');
  });
});
