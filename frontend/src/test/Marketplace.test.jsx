import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('../api/client', () => ({
  api: {
    getProducts: vi.fn().mockResolvedValue({
      data: [
        { id: 1, name: 'Tomatoes', quantity: 0, price: '5', unit: 'kg', category: 'vegetables', description: 'Fresh tomatoes', farmer_name: 'Bob', farmer_id: 10, image_url: null, review_count: 0 },
        { id: 2, name: 'Carrots', quantity: 10, price: '3', unit: 'kg', category: 'vegetables', description: 'Fresh carrots', farmer_name: 'Alice', farmer_id: 11, image_url: null, review_count: 0 },
      ],
      total: 2,
      totalPages: 1,
    }),
    searchProducts: vi.fn(),
    getAuctions: vi.fn().mockResolvedValue({ data: [] }),
    getBundles: vi.fn().mockResolvedValue({ data: [] }),
    getRecommendations: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../context/FavoritesContext', () => ({ useFavorites: () => ({ isFavorited: () => false, toggleFavorite: vi.fn() }) }));
vi.mock('../context/CompareContext', () => ({ useCompare: () => ({ products: [], toggleProduct: vi.fn(), isCompared: () => false }) }));
vi.mock('../utils/useXlmRate', () => ({ useXlmRate: () => ({ usd: () => null }) }));
vi.mock('../components/RecentlyCompared', () => ({ default: () => null }));

import Marketplace from '../pages/Marketplace';

describe('Marketplace out-of-stock badge (#451)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows Out of Stock badge for product with quantity 0', async () => {
    render(<HelmetProvider><MemoryRouter><Marketplace /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    expect(screen.getAllByLabelText('Out of stock')).toHaveLength(1);
  });

  it('disables the View button for out-of-stock product', async () => {
    render(<HelmetProvider><MemoryRouter><Marketplace /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /out of stock/i });
    expect(buttons[0]).toBeDisabled();
  });

  it('does not show Out of Stock badge for in-stock product', async () => {
    render(<HelmetProvider><MemoryRouter><Marketplace /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByText('Carrots')).toBeInTheDocument());
    expect(screen.getAllByLabelText('Out of stock')).toHaveLength(1);
  });

  it('shows enabled View button for in-stock product', async () => {
    render(<HelmetProvider><MemoryRouter><Marketplace /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByText('Carrots')).toBeInTheDocument());
    const viewButtons = screen.getAllByRole('button', { name: 'View' });
    expect(viewButtons[0]).not.toBeDisabled();
  });
});
