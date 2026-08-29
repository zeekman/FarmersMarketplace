// #1203 – Wallet SSE stream reconnects with a refreshed token when the
// embedded access token expires mid-stream, mirroring request()'s 401-retry logic.
import React from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client', () => {
  let token = 'stale-token';
  return {
    api: {
      getWallet: vi.fn().mockResolvedValue({ balance: 5, publicKey: 'GABC123', balances: [] }),
      getTransactions: vi.fn().mockResolvedValue([]),
      getNetwork: vi.fn().mockResolvedValue({ network: 'testnet' }),
      getAlerts: vi.fn().mockResolvedValue({ data: [], unreadCount: 0 }),
      getBudget: vi.fn().mockResolvedValue(null),
      getClaimableBalances: vi.fn().mockResolvedValue({ data: [] }),
      getWalletStreamUrl: vi.fn(() => `/api/wallet/stream?token=${token}`),
      refresh: vi.fn(() => {
        token = 'fresh-token';
        return Promise.resolve(token);
      }),
    },
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'buyer' } }),
}));
vi.mock('../components/Spinner', () => ({ default: () => <div>Loading...</div> }));
vi.mock('react-helmet-async', () => ({
  Helmet: () => null,
  HelmetProvider: ({ children }) => children,
}));

class MockEventSource {
  constructor(url) {
    this.url = url;
    this._listeners = {};
    MockEventSource.instances.push(this);
  }
  addEventListener(type, cb) {
    (this._listeners[type] = this._listeners[type] || []).push(cb);
  }
  removeEventListener() {}
  close() {}
  triggerError() {
    (this._listeners.error || []).forEach((cb) => cb());
  }
}
MockEventSource.instances = [];

import Wallet from '../pages/Wallet';
import { api } from '../api/client';

function renderWallet() {
  return render(
    <MemoryRouter>
      <Wallet />
    </MemoryRouter>
  );
}

describe('Wallet SSE token expiry recovery (#1203)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    global.EventSource = MockEventSource;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls api.refresh() when the stream errors out (token likely expired)', async () => {
    renderWallet();
    await act(async () => {});

    expect(MockEventSource.instances.length).toBe(1);
    const firstStream = MockEventSource.instances[0];
    expect(firstStream.url).toContain('token=stale-token');

    await act(async () => {
      firstStream.triggerError();
    });

    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('reconnects with a fresh stream URL after refreshing the token', async () => {
    renderWallet();
    await act(async () => {});

    const firstStream = MockEventSource.instances[0];

    await act(async () => {
      firstStream.triggerError();
    });

    // Advance past the backoff delay so connectStream() runs again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(MockEventSource.instances.length).toBe(2);
    const secondStream = MockEventSource.instances[1];
    expect(secondStream.url).toContain('token=fresh-token');
  });
});
