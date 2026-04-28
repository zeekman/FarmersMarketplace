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
  });

  it('shows warning and disables send button when amount exceeds available balance', async () => {
    renderWallet();
    await waitFor(() => screen.getByText(/Withdraw XLM/i));

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
    await waitFor(() => screen.getByText(/Withdraw XLM/i));

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
    await waitFor(() => screen.getByText(/Withdraw XLM/i));

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
