import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('../api/client', () => ({
  api: {
    getProducts: vi.fn(),
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

import { api } from '../api/client';
import Marketplace from '../pages/Marketplace';
import {
  SNAPSHOT_KEY,
  SNAPSHOT_TTL_MS,
  saveSnapshot,
  saveScrollPosition,
  readSnapshot,
} from '../utils/marketplaceSnapshot';

const product = (id, price = 10) => ({
  id,
  name: `Product ${id}`,
  price,
  quantity: 5,
  unit: 'kg',
  category: 'vegetables',
  farmer_name: 'Farmer',
  description: 'x'.repeat(500),
});

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('#1406 marketplace snapshot utility', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('stores only ids and view state, never product payloads', () => {
    saveSnapshot({ ids: [1, 2, 3], startPage: 1, page: 2, filters: { category: 'fruits' }, scrollY: 400 });
    const stored = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY));
    expect(Object.keys(stored).sort()).toEqual(['filters', 'ids', 'page', 'savedAt', 'scrollY', 'startPage']);
    expect(stored.ids).toEqual([1, 2, 3]);
    expect(typeof stored.savedAt).toBe('number');
  });

  it('swallows QuotaExceededError on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() =>
      saveSnapshot({ ids: [1], startPage: 1, page: 1, filters: {} })
    ).not.toThrow();
    expect(saveSnapshot({ ids: [1], startPage: 1, page: 1, filters: {} })).toBe(false);
  });

  it('swallows errors when storage access throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readSnapshot()).toBeNull();
    expect(() => saveScrollPosition(100)).not.toThrow();
  });

  it('returns null and clears the snapshot once it is older than the TTL', () => {
    saveSnapshot({ ids: [1], startPage: 1, page: 1, filters: {} });
    const savedAt = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY)).savedAt;
    expect(readSnapshot(savedAt + SNAPSHOT_TTL_MS - 1)).not.toBeNull();
    expect(readSnapshot(savedAt + SNAPSHOT_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it('ignores malformed snapshots', () => {
    sessionStorage.setItem(SNAPSHOT_KEY, '{not json');
    expect(readSnapshot()).toBeNull();
  });
});

describe('#1406 Marketplace back-navigation restore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps working when sessionStorage throws QuotaExceededError', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    api.getProducts.mockResolvedValue({ data: [product(1)], total: 1, totalPages: 1 });

    renderPage();

    expect(await screen.findByText('Product 1')).toBeInTheDocument();
  });

  it('refetches instead of restoring when the snapshot is stale', async () => {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      ids: [1, 2], startPage: 1, page: 3, filters: { category: 'fruits' }, scrollY: 900,
      savedAt: Date.now() - SNAPSHOT_TTL_MS - 1000,
    }));
    api.getProducts.mockResolvedValue({ data: [product(7)], total: 1, totalPages: 1 });

    renderPage();

    expect(await screen.findByText('Product 7')).toBeInTheDocument();
    expect(api.getProducts).toHaveBeenCalledTimes(1);
    const params = api.getProducts.mock.calls[0][0];
    expect(params.page).toBe(1);
    expect(params.category).toBeUndefined();
    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 900);
  });

  it('restores a fresh snapshot by refetching pages 1..N with current prices', async () => {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      ids: [1, 2], startPage: 1, page: 2, filters: { category: 'fruits' }, scrollY: 640,
      savedAt: Date.now(),
    }));
    api.getProducts.mockImplementation(({ page }) =>
      Promise.resolve({ data: [product(page, 99)], total: 3, totalPages: 3 })
    );

    renderPage();

    expect(await screen.findByText('Product 1')).toBeInTheDocument();
    expect(await screen.findByText('Product 2')).toBeInTheDocument();
    const pages = api.getProducts.mock.calls.map(([p]) => p.page).sort();
    expect(pages).toEqual([1, 2]);
    api.getProducts.mock.calls.forEach(([p]) => expect(p.category).toBe('fruits'));
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 640));

    const stored = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY));
    expect(stored.ids).toEqual([1, 2]);
    expect(stored.products).toBeUndefined();
  });
});
