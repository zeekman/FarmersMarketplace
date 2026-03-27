import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import Wallet from '../pages/Wallet';
import ProductDetail from '../pages/ProductDetail';

// ── getStellarErrorMessage unit tests ────────────────────────────────────────

describe('getStellarErrorMessage', () => {
  it('maps insufficient balance error', () => {
    expect(getStellarErrorMessage(new Error('insufficient balance for transfer'))).toBe(
      'Insufficient XLM balance. Please fund your wallet first.'
    );
  });

  it('maps account not found error', () => {
    expect(getStellarErrorMessage(new Error('account not found on ledger'))).toBe(
      'Stellar account not found. Please fund your wallet to activate it.'
    );
  });

  it('maps no account error', () => {
    expect(getStellarErrorMessage(new Error('no account'))).toBe(
      'Stellar account not found. Please fund your wallet to activate it.'
    );
  });

  it('maps friendbot error', () => {
    expect(getStellarErrorMessage(new Error('friendbot request failed'))).toBe(
      'Testnet faucet (Friendbot) is unavailable. Please try again later.'
    );
  });

  it('maps transaction failed error', () => {
    expect(getStellarErrorMessage(new Error('transaction failed on network'))).toBe(
      'Stellar transaction failed. Please check your balance and try again.'
    );
  });

  it('maps timeout error', () => {
    expect(getStellarErrorMessage(new Error('request timed out'))).toBe(
      'The Stellar network request timed out. Please try again.'
    );
  });

  it('maps network/fetch error', () => {
    expect(getStellarErrorMessage(new Error('Failed to fetch'))).toBe(
      'Unable to reach the Stellar network. Check your connection and try again.'
    );
  });

  it('maps rate limit error', () => {
    expect(getStellarErrorMessage(new Error('too many requests'))).toBe(
      'Too many requests to the Stellar network. Please wait a moment and retry.'
    );
  });

  it('maps bad_auth error', () => {
    expect(getStellarErrorMessage(new Error('bad_auth signature'))).toBe(
      'Stellar authorization failed. Please log in again.'
    );
  });

  it('returns original message for unknown errors', () => {
    expect(getStellarErrorMessage(new Error('some unknown error'))).toBe('some unknown error');
  });

  it('returns fallback for null/undefined', () => {
    expect(getStellarErrorMessage(null)).toBe('An unexpected error occurred. Please try again.');
  });
});

// ── Wallet component integration tests ───────────────────────────────────────

vi.mock('../api/client', () => ({
  api: {
    getWallet: vi.fn(),
    getTransactions: vi.fn(),
    fundWallet: vi.fn(),
    getProduct: vi.fn(),
    placeOrder: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'buyer', username: 'testuser' } }),
}));

import { api } from '../api/client';

describe('Wallet – network error on load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows friendly message when wallet fetch fails with network error', async () => {
    api.getWallet.mockRejectedValue(new Error('Failed to fetch'));
    api.getTransactions.mockRejectedValue(new Error('Failed to fetch'));

    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach the Stellar network/i)).toBeInTheDocument();
    });
  });

  it('shows friendly message when wallet fetch fails with insufficient balance', async () => {
    api.getWallet.mockRejectedValue(new Error('insufficient balance'));
    api.getTransactions.mockRejectedValue(new Error('insufficient balance'));

    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insufficient XLM balance/i)).toBeInTheDocument();
    });
  });
});

describe('Wallet – fund error messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getWallet.mockResolvedValue({ balance: 100, publicKey: 'GABC123' });
    api.getTransactions.mockResolvedValue([]);
  });

  it('shows friendly friendbot error on fund failure', async () => {
    api.fundWallet.mockRejectedValue(new Error('friendbot service unavailable'));

    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText(/Fund with Testnet XLM/i));

    await userEvent.click(screen.getByText(/Fund with Testnet XLM/i));

    await waitFor(() => {
      expect(screen.getByText(/Testnet faucet \(Friendbot\) is unavailable/i)).toBeInTheDocument();
    });
  });

  it('shows friendly network error on fund failure', async () => {
    api.fundWallet.mockRejectedValue(new Error('Failed to fetch'));

    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText(/Fund with Testnet XLM/i));

    await userEvent.click(screen.getByText(/Fund with Testnet XLM/i));

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach the Stellar network/i)).toBeInTheDocument();
    });
  });
});

// ── ProductDetail – buy error messaging ──────────────────────────────────────

function renderProductDetail(id = '1') {
  return render(
    <MemoryRouter initialEntries={[`/product/${id}`]}>
      <Routes>
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/marketplace" element={<div>Marketplace</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProductDetail – Stellar payment error messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProduct.mockResolvedValue({
      id: 1,
      name: 'Tomatoes',
      price: 5,
      unit: 'kg',
      quantity: 10,
      farmer_name: 'Alice',
      description: 'Fresh',
    });
  });

  it('shows friendly insufficient balance error on buy', async () => {
    api.placeOrder.mockRejectedValue(new Error('insufficient balance for transfer'));

    renderProductDetail();
    await waitFor(() => screen.getByText(/Buy Now/i));

    await userEvent.click(screen.getByText(/Buy Now/i));

    await waitFor(() => {
      expect(screen.getByText(/Insufficient XLM balance/i)).toBeInTheDocument();
    });
  });

  it('shows friendly network error on buy', async () => {
    api.placeOrder.mockRejectedValue(new Error('Failed to fetch'));

    renderProductDetail();
    await waitFor(() => screen.getByText(/Buy Now/i));

    await userEvent.click(screen.getByText(/Buy Now/i));

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach the Stellar network/i)).toBeInTheDocument();
    });
  });

  it('shows friendly transaction failed error on buy', async () => {
    api.placeOrder.mockRejectedValue(new Error('transaction failed'));

    renderProductDetail();
    await waitFor(() => screen.getByText(/Buy Now/i));

    await userEvent.click(screen.getByText(/Buy Now/i));

    await waitFor(() => {
      expect(screen.getByText(/Stellar transaction failed/i)).toBeInTheDocument();
    });
  });
});
