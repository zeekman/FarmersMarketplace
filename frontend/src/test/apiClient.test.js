/**
 * apiClient.test.js
 *
 * Tests for the auto-refresh and retry logic in frontend/src/api/client.js.
 *
 * Strategy:
 *   - Stub globalThis.fetch with vi.fn() so every HTTP call is intercepted.
 *   - Reset token state and callbacks before each test via the module's own
 *     exported setters so tests don't leak state.
 *   - Use GET endpoints (no CSRF) for retry scenarios to avoid mocking the
 *     CSRF prefetch; mutation scenarios include a CSRF token in document.cookie.
 *
 * Scenarios covered:
 *   - Successful request returns parsed JSON body
 *   - 401 → refresh → retry once returns data from the retried call
 *   - 401 → refresh fails → logoutCallback fired, throws 'Session expired'
 *   - Retry is bounded to once (fetch call count is exactly 3: orig + refresh + retry)
 *   - Retried request uses the newly issued access token in Authorization header
 *   - A subsequent 401 on the retried request is NOT retried again
 *   - Non-401 errors are thrown immediately (no refresh attempted)
 *   - Access token is sent as Bearer token in Authorization header
 *   - Requests without an access token omit the Authorization header
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Set up fetch stub before importing the module so the module-level fetch call
// inside refreshAccessToken() is captured by the stub.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  setAccessToken,
  clearAccessToken,
  setLogoutCallback,
  api,
} from '../api/client.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function okResponse(body = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function errResponse(status, body = {}) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAccessToken();
  setLogoutCallback(null);
  // Clear CSRF cookie so tests that don't need CSRF don't accidentally get one
  document.cookie = 'csrf_token=; Max-Age=0; path=/';
});

// ── core request behaviour ────────────────────────────────────────────────────

describe('Successful request', () => {
  it('returns the parsed response body on 200', async () => {
    setAccessToken('valid-token');
    mockFetch.mockResolvedValueOnce(okResponse({ wallet: 'data' }));

    const result = await api.getWallet();
    expect(result).toEqual({ wallet: 'data' });
  });

  it('sends the access token as a Bearer header', async () => {
    setAccessToken('my-access-token');
    mockFetch.mockResolvedValueOnce(okResponse({}));

    await api.getWallet();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer my-access-token');
  });

  it('omits the Authorization header when no token is set', async () => {
    clearAccessToken();
    mockFetch.mockResolvedValueOnce(okResponse({}));

    await api.getWallet();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('throws on non-OK responses without attempting a refresh', async () => {
    setAccessToken('valid-token');
    mockFetch.mockResolvedValueOnce(errResponse(403, { error: 'Forbidden' }));

    await expect(api.getWallet()).rejects.toThrow('Forbidden');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── 401 auto-refresh and retry ────────────────────────────────────────────────

describe('401 auto-refresh and retry', () => {
  it('retries the original request after a successful token refresh', async () => {
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401, { error: 'Unauthorized' })) // original
      .mockResolvedValueOnce(okResponse({ token: 'fresh-token' }))        // POST /auth/refresh
      .mockResolvedValueOnce(okResponse({ balance: 42 }));                 // retry

    const result = await api.getWallet();
    expect(result).toEqual({ balance: 42 });
  });

  it('makes exactly 3 fetch calls: original, refresh, retry', async () => {
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))
      .mockResolvedValueOnce(okResponse({ token: 'new-token' }))
      .mockResolvedValueOnce(okResponse({}));

    await api.getWallet();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('uses the freshly issued token in the Authorization header of the retry', async () => {
    setAccessToken('old-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))
      .mockResolvedValueOnce(okResponse({ token: 'brand-new-token' }))
      .mockResolvedValueOnce(okResponse({}));

    await api.getWallet();

    // Third call is the retry — it should carry the new token
    const [, retryOpts] = mockFetch.mock.calls[2];
    expect(retryOpts.headers.Authorization).toBe('Bearer brand-new-token');
  });

  it('calls logoutCallback and throws when refresh itself returns a non-OK response', async () => {
    const logoutSpy = vi.fn();
    setLogoutCallback(logoutSpy);
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))              // original
      .mockResolvedValueOnce(errResponse(401, {}));         // refresh fails

    await expect(api.getWallet()).rejects.toThrow('Session expired');
    expect(logoutSpy).toHaveBeenCalledOnce();
  });

  it('calls logoutCallback and throws when refresh throws a network error', async () => {
    const logoutSpy = vi.fn();
    setLogoutCallback(logoutSpy);
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))              // original
      .mockRejectedValueOnce(new Error('Network error'));   // refresh network error

    await expect(api.getWallet()).rejects.toThrow('Session expired');
    expect(logoutSpy).toHaveBeenCalledOnce();
  });

  it('does not retry again when the retried request also returns 401', async () => {
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))
      .mockResolvedValueOnce(okResponse({ token: 'new-token' }))
      .mockResolvedValueOnce(errResponse(401, { error: 'Still unauthorized' }));

    await expect(api.getWallet()).rejects.toThrow();
    // No 4th call — the retry loop is bounded to one attempt
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('clears the stored access token when refresh fails', async () => {
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))
      .mockResolvedValueOnce(errResponse(401, {}));

    await expect(api.getWallet()).rejects.toThrow('Session expired');

    // A subsequent request should NOT include the old expired token
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await api.getWallet().catch(() => {});
    const [, opts] = mockFetch.mock.calls[2];
    expect(opts.headers.Authorization).toBeUndefined();
  });
});

// ── refresh endpoint call details ─────────────────────────────────────────────

describe('Refresh token call', () => {
  it('calls POST /api/v1/auth/refresh with credentials: include', async () => {
    setAccessToken('t');

    mockFetch
      .mockResolvedValueOnce(errResponse(401))
      .mockResolvedValueOnce(okResponse({ token: 'new' }))
      .mockResolvedValueOnce(okResponse({}));

    await api.getWallet();

    const [refreshUrl, refreshOpts] = mockFetch.mock.calls[1];
    expect(refreshUrl).toContain('/auth/refresh');
    expect(refreshOpts.method).toBe('POST');
    expect(refreshOpts.credentials).toBe('include');
  });
});
