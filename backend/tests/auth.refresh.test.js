'use strict';

/**
 * Integration test for issue #1363:
 * Refresh-token cookie must be scoped so the SPA (which calls
 * `/api/v1/auth/*`) can silently refresh and log out.
 *
 * Covers: login via `/api/v1/auth/login` -> `/api/v1/auth/refresh` succeeds
 * -> `/api/v1/auth/logout` -> refresh fails.
 */

const request = require('supertest');

// The app is mounted with both `/api/auth` and `/api/v1/auth` routers.
// Adjust the require path if the app entrypoint differs in this repo.
const app = require('../src/app');

const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:3000';

const TEST_USER = {
  email: process.env.TEST_AUTH_EMAIL || 'refresh-test@example.com',
  password: process.env.TEST_AUTH_PASSWORD || 'Password123!',
};

describe('refresh-token cookie scoping (#1363)', () => {
  // supertest.agent keeps a cookie jar across requests, mimicking a browser.
  const agent = request.agent(app);

  let refreshCookie;

  it('logs in via /api/v1/auth/login and sets a refresh cookie scoped to /api', async () => {
    const res = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send(TEST_USER);

    expect(res.status).toBe(200);

    const setCookie = res.headers['set-cookie'] || [];
    refreshCookie = setCookie.find((c) => /refresh/i.test(c));

    expect(refreshCookie).toBeDefined();
    // The cookie path must cover both API versions, not just /api/auth.
    expect(refreshCookie).toMatch(/Path=\/api(;|$)/i);
    expect(refreshCookie).not.toMatch(/Path=\/api\/auth(;|$)/i);
  });

  it('silently refreshes via /api/v1/auth/refresh using the cookie', async () => {
    const res = await agent
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });

  it('logs out via /api/v1/auth/logout and clears the refresh cookie', async () => {
    const res = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .send({});

    expect(res.status).toBe(200);

    const setCookie = res.headers['set-cookie'] || [];
    const cleared = setCookie.find((c) => /refresh/i.test(c));
    if (cleared) {
      // clearCookie must use the same path so the browser actually drops it.
      expect(cleared).toMatch(/Path=\/api(;|$)/i);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    }
  });

  it('rejects refresh after logout (token revoked / cookie gone)', async () => {
    const res = await agent
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .send({});

    expect(res.status).toBe(401);
  });
});
