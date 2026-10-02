/**
 * Single-flight token refresh in frontend/src/api/client.js (#1363).
 *
 * A dashboard load fires half a dozen requests at once, so when the access token
 * expires they all come back 401. The backend rotates refresh tokens and revokes
 * the whole family when it sees one replayed (token_reuse_detected in
 * backend/src/routes/auth.js), so every parallel 401 must share ONE refresh call.
 *
 * Covered here:
 *   - 5 concurrent 401s → 1 POST /auth/refresh → 5 retries with the new token
 *   - a failed refresh ends the session once: 1 logoutCallback, 1 toast, no retry
 *   - the same dead session stays quiet, and a new session may be announced again
 *   - a refresh that never answers is aborted instead of hanging forever
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  api,
  setAccessToken,
  setLogoutCallback,
  CSRF_TOKEN_URL,
  REFRESH_TIMEOUT_MS,
} from '../api/client.js';

const BASE = '/api/v1';
const REFRESH_URL = `${BASE}/auth/refresh`;
// One dashboard-ish request per line, all GET so no CSRF prefetch is involved.
const PATHS = ['/wallet', '/products', '/orders', '/favorites', '/messages/unread-count'];
const fireAll = () => [
  api.getWallet(),
  api.getProducts(),
  api.getOrders(),
  api.getFavorites(),
  api.getUnreadMessageCount(),
];

function json(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

/** A refresh response that is held back until the test lets it through. */
function deferred() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Lets every already-scheduled promise callback run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function toasts() {
  return document.querySelectorAll('#toast-notifications > div');
}

/** Answers the CSRF bootstrap and every other call through `handler`. */
function stubApi(handler) {
  mockFetch.mockImplementation((url, options) => {
    if (url === CSRF_TOKEN_URL) {
      document.cookie = 'csrf_token=live-csrf; path=/';
      return Promise.resolve(json(200, { csrfToken: 'live-csrf' }));
    }
    return handler(url, options);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  // A null token also resets the "session already ended" flag between tests.
  setAccessToken(null);
  setLogoutCallback(null);
  document.cookie = 'csrf_token=test-csrf; path=/';
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById('toast-notifications')?.remove();
});

describe('concurrent 401s share one refresh', () => {
  it('refreshes once and retries all five requests with the new token', async () => {
    setAccessToken('expired-token');
    const logout = vi.fn();
    setLogoutCallback(logout);

    const gate = deferred();
    const attempts = new Map();
    const authHeaders = new Map();
    let refreshCalls = 0;

    stubApi((url, options) => {
      if (url === REFRESH_URL) {
        refreshCalls += 1;
        return gate.promise.then(() => json(200, { token: 'fresh-token' }));
      }
      const path = url.slice(BASE.length);
      const attempt = (attempts.get(path) || 0) + 1;
      attempts.set(path, attempt);
      authHeaders.set(`${path}#${attempt}`, options.headers.Authorization);
      return Promise.resolve(
        attempt === 1 ? json(401, { error: 'Unauthorized' }) : json(200, { path })
      );
    });

    const pending = Promise.all(fireAll());

    // Let all five first attempts go out and come back 401 while the refresh is
    // still running — that is what makes them concurrent.
    await flush();
    expect([...attempts.values()]).toEqual([1, 1, 1, 1, 1]);
    expect(refreshCalls).toBe(1);

    gate.release();

    const results = await pending;

    expect(refreshCalls).toBe(1); // still a single rotation
    expect([...attempts.values()]).toEqual([2, 2, 2, 2, 2]); // 5 originals + 5 retries
    expect(results).toEqual(PATHS.map((path) => ({ path })));
    PATHS.forEach((path) => expect(authHeaders.get(`${path}#2`)).toBe('Bearer fresh-token'));
    expect(authHeaders.get(`${PATHS[0]}#1`)).toBe('Bearer expired-token');
    expect(logout).not.toHaveBeenCalled();
  });

  it('retries each request at most once', async () => {
    setAccessToken('expired-token');

    let refreshCalls = 0;
    const attempts = new Map();

    stubApi((url) => {
      if (url === REFRESH_URL) {
        refreshCalls += 1;
        return Promise.resolve(json(200, { token: 'fresh-token' }));
      }
      const path = url.slice(BASE.length);
      const attempt = (attempts.get(path) || 0) + 1;
      attempts.set(path, attempt);
      return Promise.resolve(json(401, { error: 'Unauthorized' }));
    });

    await expect(api.getWallet()).rejects.toThrow('Unauthorized');

    expect(refreshCalls).toBe(1);
    expect(attempts.get('/wallet')).toBe(2); // original + one retry
  });
});

describe('a failed refresh ends the session once', () => {
  it('logs out once and toasts once for five waiting requests', async () => {
    setAccessToken('expired-token');
    const logout = vi.fn();
    setLogoutCallback(logout);

    const gate = deferred();
    const attempts = new Map();
    let refreshCalls = 0;

    stubApi((url) => {
      if (url === REFRESH_URL) {
        refreshCalls += 1;
        return gate.promise.then(() => json(401, { error: 'No refresh token' }));
      }
      const path = url.slice(BASE.length);
      attempts.set(path, (attempts.get(path) || 0) + 1);
      return Promise.resolve(json(401, { error: 'Unauthorized' }));
    });

    const settled = Promise.allSettled(fireAll());

    await flush();
    expect(refreshCalls).toBe(1);

    gate.release();
    const results = await settled;

    expect(refreshCalls).toBe(1);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
    ]);
    results.forEach((result) => expect(result.reason.message).toBe('Session expired'));
    expect([...attempts.values()]).toEqual([1, 1, 1, 1, 1]); // nothing is retried
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].textContent).toBe('Session expired');
  });

  it('stays quiet for the same dead session and speaks up again after a new login', async () => {
    setAccessToken('expired-token');
    const logout = vi.fn();
    setLogoutCallback(logout);

    stubApi(() => Promise.resolve(json(401, { error: 'No refresh token' })));

    await expect(api.getWallet()).rejects.toThrow('Session expired');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(1);

    // Requests still in flight while the app navigates to /login must not log
    // the user out (or toast) a second time for the same dead session.
    await expect(api.getProducts()).rejects.toThrow('Session expired');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(1);

    // A fresh session may announce its own expiry exactly once.
    setAccessToken('expired-again');
    await expect(api.getOrders()).rejects.toThrow('Session expired');
    expect(logout).toHaveBeenCalledTimes(2);
    expect(toasts()).toHaveLength(2);
  });
});

describe('a refresh that never answers', () => {
  it('is aborted so waiting requests fail instead of hanging forever', async () => {
    vi.useFakeTimers();
    setAccessToken('expired-token');
    const logout = vi.fn();
    setLogoutCallback(logout);

    let refreshStarted = false;

    stubApi((url, options) => {
      if (url !== REFRESH_URL) return Promise.resolve(json(401, { error: 'Unauthorized' }));
      refreshStarted = true;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const settled = api.getWallet().then(() => 'resolved', (err) => err.message);

    // Let the 401 come back and the (never answering) refresh start, so its
    // deadline is armed before the clock is advanced.
    for (let hop = 0; hop < 50 && !refreshStarted; hop += 1) await Promise.resolve();
    expect(refreshStarted).toBe(true);

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 1000);

    expect(await settled).toBe('Session expired');
    expect(logout).toHaveBeenCalledTimes(1);
  });
});