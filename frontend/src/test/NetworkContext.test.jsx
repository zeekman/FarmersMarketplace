import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { NetworkProvider, useNetwork } from '../context/NetworkContext';

function ExplorerLinks() {
  const { explorerUrl } = useNetwork();
  return (
    <>
      <a href={explorerUrl('tx', 'abc123')}>Transaction</a>
      <a href={explorerUrl('claimable-balance', 'balance456')}>Claimable balance</a>
    </>
  );
}

describe('NetworkContext explorer links', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['testnet', 'testnet'],
    ['mainnet', 'public'],
  ])('renders %s explorer links', async (network, explorerNetwork) => {
    vi.spyOn(api, 'getNetwork').mockResolvedValue({ network });

    render(
      <NetworkProvider>
        <ExplorerLinks />
      </NetworkProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Transaction' })).toHaveAttribute(
        'href',
        `https://stellar.expert/explorer/${explorerNetwork}/tx/abc123`
      );
    });
    expect(screen.getByRole('link', { name: 'Claimable balance' })).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/${explorerNetwork}/claimable-balance/balance456`
    );
  });
});