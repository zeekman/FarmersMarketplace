import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkProvider, useNetwork } from './NetworkContext';

const originalFetch = global.fetch;

function Consumer() {
  const { network, isMainnet, isTestnet, mismatch, loading } = useNetwork();
  return (
    <div>
      <span data-testid="network">{network}</span>
      <span data-testid="is-mainnet">{String(isMainnet)}</span>
      <span data-testid="is-testnet">{String(isTestnet)}</span>
      <span data-testid="mismatch">{String(mismatch)}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

function mockNetworkResponse(network) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ network }),
  });
}

describe('NetworkContext', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports testnet state when backend returns testnet', async () => {
    mockNetworkResponse('testnet');
    render(
      <NetworkProvider>
        <Consumer />
      </NetworkProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('network')).toHaveTextContent('testnet');
    });
    expect(screen.getByTestId('is-testnet')).toHaveTextContent('true');
    expect(screen.getByTestId('is-mainnet')).toHaveTextContent('false');
    expect(screen.getByTestId('mismatch')).toHaveTextContent('false');
  });

  it('reports mainnet state when backend returns mainnet', async () => {
    mockNetworkResponse('mainnet');
    render(
      <NetworkProvider>
        <Consumer />
      </NetworkProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('network')).toHaveTextContent('mainnet');
    });
    expect(screen.getByTestId('is-mainnet')).toHaveTextContent('true');
    expect(screen.getByTestId('is-testnet')).toHaveTextContent('false');
    expect(screen.getByTestId('mismatch')).toHaveTextContent('false');
  });

  it('flags a mismatch when backend network differs from build-time network', async () => {
    vi.stubEnv('VITE_STELLAR_NETWORK', 'testnet');
    mockNetworkResponse('mainnet');
    render(
      <NetworkProvider>
        <Consumer />
      </NetworkProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('mismatch')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('network')).toHaveTextContent('mainnet');
  });

  it('does not flag a mismatch when networks agree', async () => {
    vi.stubEnv('VITE_STELLAR_NETWORK', 'testnet');
    mockNetworkResponse('testnet');
    render(
      <NetworkProvider>
        <Consumer />
      </NetworkProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('mismatch')).toHaveTextContent('false');
  });

  it('falls back gracefully when the network request fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <NetworkProvider>
        <Consumer />
      </NetworkProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('mismatch')).toHaveTextContent('false');
  });
});
