import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('../api/client', () => ({
  api: {
    getWallet: vi.fn(),
    getTransactions: vi.fn().mockResolvedValue([]),
    getNetwork: vi.fn().mockResolvedValue({ network: 'testnet' }),
    getAlerts: vi.fn().mockResolvedValue({ data: [], unreadCount: 0 }),
    getBudget: vi.fn().mockResolvedValue(null),
    getWalletStreamUrl: vi.fn().mockReturnValue(''),
    withdrawFunds: vi.fn(),
    getClaimableBalances: vi.fn().mockResolvedValue({ data: [] }),
    claimBalance: vi.fn(),
    getMarketRate: vi.fn().mockResolvedValue({ midPrice: 0 }),
    markAlertRead: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'buyer' } }),
}));

vi.mock('../components/Spinner', () => ({ default: () => <div>Loading...</div> }));
vi.mock('react-helmet-async', () => ({
  Helmet: () => null,
  HelmetProvider: ({ children }) => children,
}));

import Wallet from '../pages/Wallet';
import { api } from '../api/client';

function renderWallet() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('#456 Wallet send form – balance validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // balance = 5 XLM, availableBalance = 5 - 1 = 4 XLM
    api.getWallet.mockResolvedValue({ balance: 5, publicKey: 'GABC123', balances: [] });
    api.getTransactions.mockResolvedValue([]);
    api.getClaimableBalances.mockResolvedValue({ data: [] });
  });

  it('shows warning and disables send button when amount exceeds available balance', async () => {
    renderWallet();
    await waitFor(() => screen.getByRole('button', { name: /Withdraw XLM/i }));

    const amountInput = screen.getByPlaceholderText('0.00');
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '10');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Insufficient balance. You have 4.00 XLM available.'
      );
    });

    const submitBtn = screen.getByRole('button', { name: /Withdraw XLM/i });
    expect(submitBtn).toBeDisabled();
  });

  it('does not show warning when amount is within available balance', async () => {
    renderWallet();
    await waitFor(() => screen.getByRole('button', { name: /Withdraw XLM/i }));

    const amountInput = screen.getByPlaceholderText('0.00');
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '3');

    expect(screen.queryByRole('alert')).toBeNull();

    const submitBtn = screen.getByRole('button', { name: /Withdraw XLM/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('factors in 1 XLM base reserve in available balance calculation', async () => {
    // balance = 1.5, available = 0.5
    api.getWallet.mockResolvedValue({ balance: 1.5, publicKey: 'GABC123', balances: [] });
    renderWallet();
    await waitFor(() => screen.getByRole('button', { name: /Withdraw XLM/i }));

    const amountInput = screen.getByPlaceholderText('0.00');
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '1');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Insufficient balance. You have 0.50 XLM available.'
      );
    });
  });
});

describe('#778 Wallet claimable balances section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getWallet.mockResolvedValue({ balance: 10, publicKey: 'GABC123', balances: [] });
    api.getTransactions.mockResolvedValue([]);
  });

  it('shows the Pending Claims section when claimable balances are returned', async () => {
    api.getClaimableBalances.mockResolvedValue({
      data: [
        {
          id: 'balance-id-001',
          amount: '5.0000000',
          asset: 'native',
          claimant_condition: { unconditional: true },
        },
      ],
    });

    renderWallet();
    await waitFor(() => screen.getByTestId('pending-claims-section'));

    expect(screen.getByText(/Pending Claims/i)).toBeTruthy();
    expect(screen.getByText('5.00 XLM')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Claim 5\.00 XLM/i })).toBeTruthy();
  });

  it('does not show the Pending Claims section when there are no claimable balances', async () => {
    api.getClaimableBalances.mockResolvedValue({ data: [] });

    renderWallet();
    await waitFor(() => screen.getByRole('button', { name: /Withdraw XLM/i }));
    await waitFor(() => expect(api.getClaimableBalances).toHaveBeenCalled());

    expect(screen.queryByTestId('pending-claims-section')).toBeNull();
  });

  it('shows a spinner on the Claim button while claim is in progress', async () => {
    api.getClaimableBalances.mockResolvedValue({
      data: [{ id: 'bal-001', amount: '2.5000000', asset: 'native', claimant_condition: null }],
    });
    // Never resolves during this test
    api.claimBalance.mockReturnValue(new Promise(() => {}));

    renderWallet();
    const claimBtn = await screen.findByRole('button', { name: /Claim 2\.50 XLM/i });
    await userEvent.click(claimBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Claim 2\.50 XLM/i })).toBeDisabled();
    });
    expect(screen.getByText(/Claiming/i)).toBeTruthy();
  });

  it('removes the balance row after a successful claim', async () => {
    api.getClaimableBalances.mockResolvedValue({
      data: [{ id: 'bal-002', amount: '3.0000000', asset: 'native', claimant_condition: { unconditional: true } }],
    });
    api.claimBalance.mockResolvedValue({ success: true, txHash: 'abc123', balance: 13 });

    renderWallet();
    const claimBtn = await screen.findByRole('button', { name: /Claim 3\.00 XLM/i });
    await userEvent.click(claimBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('claimable-balance-row')).toBeNull();
    });
  });

  it('shows the truncated balance ID', async () => {
    const longId = '00000000deadbeef000000001234567890abcdef000000009999';
    api.getClaimableBalances.mockResolvedValue({
      data: [{ id: longId, amount: '1.0000000', asset: 'native', claimant_condition: null }],
    });

    renderWallet();
    await screen.findByTestId('pending-claims-section');
    // Should be truncated, not the full string
    expect(screen.queryByText(longId)).toBeNull();
    expect(screen.getByText(/00000000…/)).toBeTruthy();
  });
});
