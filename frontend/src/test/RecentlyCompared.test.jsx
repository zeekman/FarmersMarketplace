import React from 'react';
import { render, renderHook, act, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompareProvider, useCompare } from '../context/CompareContext';
import RecentlyCompared, { MAX_RECENTLY_COMPARED } from '../components/RecentlyCompared';
import { api } from '../api/client';

const HISTORY_KEY = 'comparison_history';

function wrapper({ children }) {
  return (
    <MemoryRouter initialEntries={['/marketplace']}>
      <CompareProvider>{children}</CompareProvider>
    </MemoryRouter>
  );
}

describe('RecentlyCompared / CompareContext MAX_RECENTLY_COMPARED eviction (#1202)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evicts exactly the oldest entry once MAX_RECENTLY_COMPARED + 1 comparisons are saved', () => {
    const { result } = renderHook(() => useCompare(), { wrapper });

    for (let i = 1; i <= MAX_RECENTLY_COMPARED + 1; i++) {
      act(() => {
        result.current.saveToHistory([i]);
      });
    }

    // State: capped at MAX_RECENTLY_COMPARED, newest first, oldest (id batch 1) evicted
    expect(result.current.history).toHaveLength(MAX_RECENTLY_COMPARED);
    expect(result.current.history[0].productIds).toEqual([MAX_RECENTLY_COMPARED + 1]);
    expect(result.current.history.some(e => e.productIds[0] === 1)).toBe(false);

    // localStorage mirrors the capped, evicted state
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY));
    expect(stored).toHaveLength(MAX_RECENTLY_COMPARED);
    expect(stored.some(e => e.productIds[0] === 1)).toBe(false);
    expect(stored[0].productIds).toEqual([MAX_RECENTLY_COMPARED + 1]);
  });

  it('does not evict anything when saving exactly MAX_RECENTLY_COMPARED comparisons', () => {
    const { result } = renderHook(() => useCompare(), { wrapper });

    for (let i = 1; i <= MAX_RECENTLY_COMPARED; i++) {
      act(() => {
        result.current.saveToHistory([i]);
      });
    }

    expect(result.current.history).toHaveLength(MAX_RECENTLY_COMPARED);
    expect(result.current.history.some(e => e.productIds[0] === 1)).toBe(true);
  });

  it('aborts product lookups when the component unmounts', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([
      { id: 1, productIds: [42], timestamp: new Date().toISOString() },
    ]));
    vi.spyOn(api, 'getProduct').mockImplementation(() => new Promise(() => {}));

    const { unmount } = render(<RecentlyCompared />, { wrapper });
    await waitFor(() => expect(api.getProduct).toHaveBeenCalled());
    const signal = api.getProduct.mock.calls[0][1].signal;

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('labels a 404 product unavailable and removes it from comparison history', async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([
      { id: 1, productIds: [42], timestamp: new Date().toISOString() },
    ]));
    vi.spyOn(api, 'getProduct').mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

    render(<RecentlyCompared />, { wrapper });

    expect(await screen.findByText('No longer available')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(HISTORY_KEY))).toEqual([]));
  });
});
