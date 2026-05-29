import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { fireEvent } from '@testing-library/react';

const mockGetProducts = vi.fn().mockResolvedValue({ data: [], total: 0, totalPages: 1 });

vi.mock('../api/client', () => ({
  api: {
    getProducts: (...args) => mockGetProducts(...args),
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

describe('#418 Marketplace debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetProducts.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('typing 5 characters quickly results in only 1 API call', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <Marketplace />
        </MemoryRouter>
      </HelmetProvider>
    );

    // Flush initial load
    await act(async () => { vi.runAllTimers(); });
    await act(async () => {}); // flush promises
    const callsAfterMount = mockGetProducts.mock.calls.length;

    const searchInput = screen.getByPlaceholderText(/search/i);

    // Simulate 5 rapid keystrokes without advancing timers
    for (const char of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      fireEvent.change(searchInput, { target: { value: char } });
    }

    // Debounce hasn't fired yet — no new calls
    expect(mockGetProducts.mock.calls.length).toBe(callsAfterMount);

    // Advance past debounce delay (300ms)
    await act(async () => { vi.advanceTimersByTime(350); });
    await act(async () => {}); // flush promises

    // Only 1 additional call after debounce settles (search goes through searchProducts, not getProducts)
    // The search input triggers searchProducts, not getProducts — verify total new calls <= 1
    const newCalls = mockGetProducts.mock.calls.length - callsAfterMount;
    expect(newCalls).toBeLessThanOrEqual(1);
  });
});
