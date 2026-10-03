/**
 * CSRF bootstrap in api/client.js (#1380).
 *
 *   - the token is fetched from /api/v1/auth/csrf-token (not /api/v1/csrf-token)
 *   - a missing cookie after the fetch (or a non-OK response) throws a descriptive error
 *   - a 403 "CSRF token missing/invalid" refreshes the token once and retries
 *   - exempt paths (login/register/recover/refresh/logout) never fetch a token
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { api, clearAccessToken, setLogoutCallback, ensureCsrfToken, CSRF_EXEMPT } from '../api/client.js';

const CSRF_URL = '/api/v1/auth/csrf-token';
const FUND_URL = '/api/v1/wallet/fund';
const LOGOUT_URL = '/api/v1/auth/logout';

// /auth/logout is CSRF-exempt on the backend (#1363), so the bootstrap scenarios
// below exercise a protected mutation instead.
const protectedMutation = () => api.fundWallet();

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

    await protectedMutation();

    const urls = mockFetch.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe(CSRF_URL);
    expect(urls).not.toContain('/api/v1/csrf-token');
    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.headers['X-CSRF-Token']).toBe('token-1');
  });

  it('does not refetch when the cookie already exists', async () => {
    setCookie('existing');
    backend(() => json(200, {}));

    await protectedMutation();

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([FUND_URL]);
    expect(mockFetch.mock.calls[0][1].headers['X-CSRF-Token']).toBe('existing');
  });

  it('throws a descriptive error when the endpoint does not set the cookie', async () => {
    backend(() => json(200, {}), { setsCookie: false });

    await expect(ensureCsrfToken()).rejects.toThrow(/did not set the csrf_token cookie/);
    await expect(protectedMutation()).rejects.toThrow(/CSRF token/);
    // The mutation itself is never sent without a token.
    expect(mockFetch.mock.calls.map(([url]) => url)).not.toContain(FUND_URL);
  });

  it('throws a descriptive error when the endpoint returns a non-OK status', async () => {
    backend(() => json(200, {}), { tokenStatus: 404 });

    await expect(ensureCsrfToken()).rejects.toThrow(/returned HTTP 404/);
  });

  it('shares one in-flight token request between concurrent mutations', async () => {
    backend(() => json(200, {}));

    await Promise.all([protectedMutation(), api.updateProfile({ name: 'x' })]);

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

    await expect(protectedMutation()).resolves.toEqual({ success: true });

    const calls = mockFetch.mock.calls;
    expect(calls.map(([url]) => url)).toEqual([FUND_URL, CSRF_URL, FUND_URL]);
    expect(calls[0][1].headers['X-CSRF-Token']).toBe('stale');
    expect(calls[2][1].headers['X-CSRF-Token']).toBe('token-1');
  });

  it('retries only once when the second attempt also fails CSRF', async () => {
    setCookie('stale');
    backend(() => json(403, { error: 'CSRF token missing' }));

    await expect(protectedMutation()).rejects.toThrow('CSRF token missing');

    expect(mockFetch.mock.calls.filter(([url]) => url === FUND_URL)).toHaveLength(2);
  });

  it('does not retry other 403s', async () => {
    setCookie('ok');
    backend(() => json(403, { error: 'Admins only' }));

    await expect(protectedMutation()).rejects.toThrow('Admins only');

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([FUND_URL]);
  });
});

describe('CSRF-exempt paths', () => {
  it('matches the backend exemption list', () => {
    expect(CSRF_EXEMPT).toEqual([
      '/auth/login',
      '/auth/register',
      '/auth/recover',
      '/auth/refresh',
      '/auth/logout',
    ]);
  });

  it.each([
    ['login', () => api.login({ email: 'a@b.c', password: 'x' }), '/api/v1/auth/login'],
    ['register', () => api.register({ email: 'a@b.c' }), '/api/v1/auth/register'],
    ['recover', () => api.recoverAccount({ mnemonic: 'x' }), '/api/v1/auth/recover'],
    ['logout', () => api.logout(), LOGOUT_URL],
  ])('%s never fetches a CSRF token', async (_name, call, url) => {
    backend(() => json(200, {}));

    await call();

    expect(mockFetch.mock.calls.map(([u]) => u)).toEqual([url]);
    expect(mockFetch.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
  });

  it('refreshes even when no CSRF token can be fetched', async () => {
    // /auth/refresh is exempt on the backend, so a broken CSRF bootstrap must
    // not stop the refresh from going out (#1363).
    mockFetch.mockImplementation((url) =>
      url === CSRF_URL ? json(500, {}) : json(200, { token: 'fresh' }),
    );

    await expect(api.refresh()).resolves.toBe('fresh');
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([CSRF_URL, '/api/v1/auth/refresh']);
  });

  it('GET requests never fetch a CSRF token', async () => {
    backend(() => json(200, {}));

    await api.getWallet();

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/wallet']);
  });
});
