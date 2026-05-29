import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, setAccessToken, clearAccessToken, setLogoutCallback, setLoadingCallback } from '../api/client';

const BASE = '/api';

describe('api/client.js (#442)', () => {
  let logoutCallback;

  beforeEach(() => {
    logoutCallback = vi.fn();
    setLogoutCallback(logoutCallback);
    setLoadingCallback(null);
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it('retries the original request after a successful token refresh', async () => {
    const callLog = [];
    global.fetch = vi.fn().mockImplementation((url) => {
      callLog.push(url);
      // 1st call: /api/products → 401
      if (callLog.length === 1) {
        return Promise.resolve({
          status: 401,
          ok: false,
          json: () => Promise.resolve({}),
        });
      }
      // 2nd call: /api/auth/refresh → success
      if (callLog.length === 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: 'new-token' }),
        });
      }
      // 3rd call: /api/products (retry) → 200
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ success: true, data: 'test' }),
      });
    });

    const result = await api.getProducts();
    expect(result).toEqual({ success: true, data: 'test' });
    expect(callLog).toEqual([
      '/api/products',
      '/api/auth/refresh',
      '/api/products',
    ]);
    expect(logoutCallback).not.toHaveBeenCalled();
  });

  it('calls logoutCallback and does not retry when refresh fails (returns null)', async () => {
    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({}),
        });
      }
      requestCount++;
      return Promise.resolve({
        status: 401,
        ok: false,
        json: () => Promise.resolve({}),
      });
    });

    await expect(api.getProducts()).rejects.toThrow('Session expired');
    // Original request should only have been attempted once (no retry after failed refresh)
    expect(requestCount).toBe(1);
    expect(logoutCallback).toHaveBeenCalledTimes(1);
  });

  it('calls logoutCallback and does not retry when refresh throws', async () => {
    let requestCount = 0;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.reject(new Error('Network error'));
      }
      requestCount++;
      return Promise.resolve({
        status: 401,
        ok: false,
        json: () => Promise.resolve({}),
      });
    });

    await expect(api.getProducts()).rejects.toThrow('Session expired');
    expect(requestCount).toBe(1);
    expect(logoutCallback).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-401 errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    await expect(api.getProducts()).rejects.toThrow('Server error');
    expect(logoutCallback).not.toHaveBeenCalled();
  });
});
