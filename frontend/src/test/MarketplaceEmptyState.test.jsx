import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('../api/client', () => ({
  api: {
    getProducts: vi.fn().mockResolvedValue({ data: [], total: 0, totalPages: 1 }),
    searchProducts: vi.fn().mockResolvedValue({ data: [] }),
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

describe('#419 Marketplace empty state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows no-products message with role=status when products list is empty', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <Marketplace />
        </MemoryRouter>
      </HelmetProvider>
    );
    await waitFor(() => {
      const status = document.querySelector('[role="status"]');
      expect(status).not.toBeNull();
    });
  });

  it('shows a Clear filters button in the empty state', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <Marketplace />
        </MemoryRouter>
      </HelmetProvider>
    );
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    // The Clear filters button should be inside the status region
    const statusEl = screen.getByRole('status');
    expect(statusEl.querySelector('button')).not.toBeNull();
  });
});
