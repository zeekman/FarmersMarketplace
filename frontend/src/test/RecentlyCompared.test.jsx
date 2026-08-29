import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import { CompareProvider, useCompare } from '../context/CompareContext';
import { MAX_RECENTLY_COMPARED } from '../components/RecentlyCompared';

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
});
