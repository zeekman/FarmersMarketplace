import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import Wallet from '../pages/Wallet';
import ProductDetail from '../pages/ProductDetail';

// ── getStellarErrorMessage unit tests ────────────────────────────────────────

describe('getStellarErrorMessage', () => {
  it('maps insufficient balance error', () => {
    expect(getStellarErrorMessage(new Error('insufficient balance for transfer')))
      .toBe('Insufficient XLM balance. Please fund your wallet first.');
  });

  it('maps account not found error', () => {
    expect(getStellarErrorMessage(new Error('account not found on ledger')))
      .toBe('Stellar account not found. Please fund your wallet to activate it.');
  });

  it('maps no account error', () => {
    expect(getStellarErrorMessage(new Error('no account')))
      .toBe('Stellar account not found. Please fund your wallet to activate it.');
  });

  it('maps friendbot error', () => {
    expect(getStellarErrorMessage(new Error('friendbot request failed')))
      .toBe('Testnet faucet (Friendbot) is unavailable. Please try again later.');
  });

  it('maps transaction failed error', () => {
    expect(getStellarErrorMessage(new Error('transaction failed on network')))
      .toBe('Stellar transaction failed. Please check your balance and try again.');
  });

  it('maps timeout error', () => {
    expect(getStellarErrorMessage(new Error('request timed out')))
      .toBe('The Stellar network request timed out. Please try again.');
  });

  it('maps network/fetch error', () => {
    expect(getStellarErrorMessage(new Error('Failed to fetch')))
      .toBe('Unable to reach the Stellar network. Check your connection and try again.');
  });

  it('maps rate limit error', () => {
    expect(getStellarErrorMessage(new Error('too many requests')))
      .toBe('Too many requests to the Stellar network. Please wait a moment and retry.');
  });

  it('maps bad_auth error', () => {
    expect(getStellarErrorMessage(new Error('bad_auth signature')))
      .toBe('Stellar authorization failed. Please log in again.');
  });

  it('returns original message for unknown errors', () => {
    expect(getStellarErrorMessage(new Error('some unknown error')))
      .toBe('some unknown error');
  });

  it('returns fallback for null/undefined', () => {
    expect(getStellarErrorMessage(null))
      .toBe('An unexpected error occurred. Please try again.');
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
    getProductReviews: vi.fn().mockResolvedValue({ data: [] }),
    getProductShareMeta: vi.fn().mockResolvedValue({ data: null }),
    getProductImages: vi.fn().mockResolvedValue({ data: [] }),
    getProductTiers: vi.fn().mockResolvedValue({ data: [] }),
    getPriceHistory: vi.fn().mockResolvedValue({ data: [] }),
    getCalendar: vi.fn().mockResolvedValue({ data: [] }),
    getAddresses: vi.fn().mockResolvedValue({ data: [] }),
    getMyAlert: vi.fn().mockResolvedValue({ subscribed: false }),
    getOrders: vi.fn().mockResolvedValue({ data: [] }),
    getWalletAssets: vi.fn().mockResolvedValue({ data: [] }),
    getFeePreview: vi.fn().mockResolvedValue(null),
    getXlmRate: vi.fn().mockResolvedValue({ usd: 0.1 }),
    getNetwork: vi.fn().mockResolvedValue({ network: 'Test SDF Network ; September 2015' }),
    getBudget: vi.fn().mockResolvedValue({ balance: 0 }),
    getAlerts: vi.fn().mockResolvedValue({ data: [], unreadCount: 0 }),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'buyer', username: 'testuser' } }),
}));

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorited: () => false, toggleFavorite: vi.fn() }),
}));

vi.mock('../components/StarRating', () => ({ default: () => null }));
vi.mock('../components/Spinner', () => ({ default: () => <div data-testid="spinner">Loading...</div> }));
vi.mock('../components/FlashSaleCountdown', () => ({ default: () => null }));
vi.mock('../components/ShareButtons', () => ({ default: () => null }));
vi.mock('../components/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('react-helmet-async', () => ({ Helmet: () => null, HelmetProvider: ({ children }) => children }));
vi.mock('qrcode.react', () => ({ QRCode: () => null, default: () => null }));

import { api } from '../api/client';

describe('Wallet – network error on load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows friendly message when wallet fetch fails with network error', async () => {
    api.getWallet.mockRejectedValue(new Error('Failed to fetch'));
    api.getTransactions.mockRejectedValue(new Error('Failed to fetch'));

    render(<HelmetProvider><MemoryRouter><Wallet /></MemoryRouter></HelmetProvider>);

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach the Stellar network/i)).toBeInTheDocument();
    });
  });

  it('shows friendly message when wallet fetch fails with insufficient balance', async () => {
    api.getWallet.mockRejectedValue(new Error('insufficient balance'));
    api.getTransactions.mockRejectedValue(new Error('insufficient balance'));

    render(<HelmetProvider><MemoryRouter><Wallet /></MemoryRouter></HelmetProvider>);

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

    render(<HelmetProvider><MemoryRouter><Wallet /></MemoryRouter></HelmetProvider>);
    await waitFor(() => screen.getByText(/Fund with Testnet XLM/i));

    await userEvent.click(screen.getByText(/Fund with Testnet XLM/i));

    await waitFor(() => {
      expect(screen.getByText(/Testnet faucet \(Friendbot\) is unavailable/i)).toBeInTheDocument();
    });
  });

  it('shows friendly network error on fund failure', async () => {
    api.fundWallet.mockRejectedValue(new Error('Failed to fetch'));

    render(<HelmetProvider><MemoryRouter><Wallet /></MemoryRouter></HelmetProvider>);
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
      id: 1, name: 'Tomatoes', price: 5, unit: 'kg',
      quantity: 10, farmer_name: 'Alice', description: 'Fresh',
    });
    api.getProductReviews.mockResolvedValue({ data: [] });
    api.getProductShareMeta.mockResolvedValue({ data: null });
    api.getProductImages.mockResolvedValue({ data: [] });
    api.getProductTiers.mockResolvedValue({ data: [] });
    api.getPriceHistory.mockResolvedValue({ data: [] });
    api.getCalendar.mockResolvedValue({ data: [] });
    api.getAddresses.mockResolvedValue({ data: [] });
    api.getMyAlert.mockResolvedValue({ subscribed: false });
    api.getOrders.mockResolvedValue({ data: [] });
    api.getWalletAssets.mockResolvedValue({ data: [] });
    api.getFeePreview.mockResolvedValue(null);
    api.getXlmRate.mockResolvedValue({ usd: 0.1 });
  });

  function getBuyButton() {
    return screen.getByTestId('buy-now-btn');
  }

  it('shows friendly insufficient balance error on buy', async () => {
    api.placeOrder.mockRejectedValue(new Error('insufficient balance for transfer'));

    renderProductDetail();
    await waitFor(() => screen.getByText('Tomatoes'), { timeout: 3000 });

    await userEvent.click(getBuyButton());

    await waitFor(() => {
      expect(screen.getByText(/Insufficient XLM balance/i)).toBeInTheDocument();
    });
  });

  it('shows friendly network error on buy', async () => {
    api.placeOrder.mockRejectedValue(new Error('Failed to fetch'));

    renderProductDetail();
    await waitFor(() => screen.getByText('Tomatoes'), { timeout: 3000 });

    await userEvent.click(getBuyButton());

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach the Stellar network/i)).toBeInTheDocument();
    });
  });

  it('shows friendly transaction failed error on buy', async () => {
    api.placeOrder.mockRejectedValue(new Error('transaction failed'));

    renderProductDetail();
    await waitFor(() => screen.getByText('Tomatoes'), { timeout: 3000 });

    await userEvent.click(getBuyButton());

    await waitFor(() => {
      expect(screen.getByText(/Stellar transaction failed/i)).toBeInTheDocument();
    });
  });

  it('double-clicking Buy Now results in only one API call', async () => {
    let resolveOrder;
    api.placeOrder.mockReturnValue(new Promise(res => { resolveOrder = res; }));

    renderProductDetail();
    await waitFor(() => screen.getByText('Tomatoes'), { timeout: 3000 });

    const btn = getBuyButton();
    await userEvent.click(btn);
    // Button should now be disabled — second click must be a no-op
    await userEvent.click(btn);

    resolveOrder({ orderId: 1, totalPrice: '5.0000000', txHash: 'abc' });

    await waitFor(() => {
      expect(api.placeOrder).toHaveBeenCalledTimes(1);
    });
  });
});
