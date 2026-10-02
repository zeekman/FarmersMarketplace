/**
 * CSRF bootstrap in api/client.js (#1380).
 *
 *   - the token is fetched from /api/v1/auth/csrf-token (not /api/v1/csrf-token)
 *   - a missing cookie after the fetch (or a non-OK response) throws a descriptive error
 *   - a 403 "CSRF token missing/invalid" refreshes the token once and retries
 *   - exempt paths (login/register/recover) never fetch a token
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { api, clearAccessToken, setLogoutCallback, ensureCsrfToken, CSRF_EXEMPT } from '../api/client.js';

const CSRF_URL = '/api/v1/auth/csrf-token';

function json(status, body = {}) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function setCookie(value) {
  document.cookie = `csrf_token=${value}; path=/`;
}

function clearCookie() {
  document.cookie = 'csrf_token=; Max-Age=0; path=/';
}

// Simulates the backend: GET csrf-token sets the cookie, everything else answers `handler`.
function backend(handler, { setsCookie = true, tokenStatus = 200 } = {}) {
  let issued = 0;
  mockFetch.mockImplementation((url, opts = {}) => {
    if (url === CSRF_URL) {
      issued += 1;
      if (setsCookie && tokenStatus === 200) setCookie(`token-${issued}`);
      return json(tokenStatus, { csrfToken: `token-${issued}` });
    }
    return handler(url, opts);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  clearAccessToken();
  setLogoutCallback(null);
  clearCookie();
});

describe('CSRF bootstrap', () => {
  it('fetches the token from /api/v1/auth/csrf-token before the first mutation', async () => {
    backend(() => json(200, { success: true }));

    await api.logout();

    const urls = mockFetch.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe(CSRF_URL);
    expect(urls).not.toContain('/api/v1/csrf-token');
    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.headers['X-CSRF-Token']).toBe('token-1');
  });

  it('does not refetch when the cookie already exists', async () => {
    setCookie('existing');
    backend(() => json(200, {}));

    await api.logout();

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/logout']);
    expect(mockFetch.mock.calls[0][1].headers['X-CSRF-Token']).toBe('existing');
  });

  it('throws a descriptive error when the endpoint does not set the cookie', async () => {
    backend(() => json(200, {}), { setsCookie: false });

    await expect(ensureCsrfToken()).rejects.toThrow(/did not set the csrf_token cookie/);
    await expect(api.logout()).rejects.toThrow(/CSRF token/);
    // The mutation itself is never sent without a token.
    expect(mockFetch.mock.calls.map(([url]) => url)).not.toContain('/api/v1/auth/logout');
  });

  it('throws a descriptive error when the endpoint returns a non-OK status', async () => {
    backend(() => json(200, {}), { tokenStatus: 404 });

    await expect(ensureCsrfToken()).rejects.toThrow(/returned HTTP 404/);
  });

  it('shares one in-flight token request between concurrent mutations', async () => {
    backend(() => json(200, {}));

    await Promise.all([api.logout(), api.fundWallet()]);

    expect(mockFetch.mock.calls.filter(([url]) => url === CSRF_URL)).toHaveLength(1);
  });
});

describe('403 CSRF retry', () => {
  it('refreshes the token once and retries on "CSRF token invalid"', async () => {
    setCookie('stale');
    let attempts = 0;
    backend(() => {
      attempts += 1;
      return attempts === 1 ? json(403, { error: 'CSRF token invalid' }) : json(200, { success: true });
    });

    await expect(api.logout()).resolves.toEqual({ success: true });

    const calls = mockFetch.mock.calls;
    expect(calls.map(([url]) => url)).toEqual(['/api/v1/auth/logout', CSRF_URL, '/api/v1/auth/logout']);
    expect(calls[0][1].headers['X-CSRF-Token']).toBe('stale');
    expect(calls[2][1].headers['X-CSRF-Token']).toBe('token-1');
  });

  it('retries only once when the second attempt also fails CSRF', async () => {
    setCookie('stale');
    backend(() => json(403, { error: 'CSRF token missing' }));

    await expect(api.logout()).rejects.toThrow('CSRF token missing');

    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/v1/auth/logout')).toHaveLength(2);
  });

  it('does not retry other 403s', async () => {
    setCookie('ok');
    backend(() => json(403, { error: 'Admins only' }));

    await expect(api.logout()).rejects.toThrow('Admins only');

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/logout']);
  });
});

/**
 * The frontend build context is ./frontend, so CSRF_EXEMPT cannot be imported
 * from the backend — it is duplicated. Read the backend list so the two can't
 * silently drift apart (#1363).
 */
function backendExemptSuffixes() {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const file = path.join(dir, 'backend', 'src', 'middleware', 'csrf.js');
    if (existsSync(file)) {
      const block = readFileSync(file, 'utf8').match(/EXEMPT_SUFFIXES\s*=\s*\[([\s\S]*?)\]/);
      if (block) return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not read EXEMPT_SUFFIXES from backend/src/middleware/csrf.js');
}

describe('CSRF-exempt paths', () => {
  it('matches the backend exemption list', () => {
    // /auth/refresh never goes through request() (see refreshAccessToken) and
    // /auth/logout still sends the header, which the backend accepts; every
    // other backend exemption must be listed here too.
    const sessionRoutes = ['/auth/refresh', '/auth/logout'];
    expect(CSRF_EXEMPT).toEqual(
      backendExemptSuffixes().filter((route) => !sessionRoutes.includes(route))
    );
  });

  it.each([
    ['login', () => api.login({ email: 'a@b.c', password: 'x' }), '/api/v1/auth/login'],
    ['register', () => api.register({ email: 'a@b.c' }), '/api/v1/auth/register'],
    ['recover', () => api.recoverAccount({ mnemonic: 'x' }), '/api/v1/auth/recover'],
  ])('%s never fetches a CSRF token', async (_name, call, url) => {
    backend(() => json(200, {}));

    await call();

    expect(mockFetch.mock.calls.map(([u]) => u)).toEqual([url]);
    expect(mockFetch.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
  });

  it('GET requests never fetch a CSRF token', async () => {
    backend(() => json(200, {}));

    await api.getWallet();

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/wallet']);
  });
});
