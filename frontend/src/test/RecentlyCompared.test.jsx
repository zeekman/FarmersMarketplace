import { describe, it, expect, beforeEach } from 'vitest';

// MAX_RECENTLY_COMPARED constant as defined in RecentlyCompared.jsx
const MAX_RECENTLY_COMPARED = 10;

// Replicate the saveToHistory logic from CompareContext
const HISTORY_KEY = 'comparison_history';

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

function addEntry(history, productIds) {
  const newEntry = { id: Date.now(), productIds, timestamp: new Date().toISOString() };
  const updated = [newEntry, ...history].slice(0, MAX_RECENTLY_COMPARED);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

describe('RecentlyCompared MAX_RECENTLY_COMPARED', () => {
  beforeEach(() => localStorage.clear());

  it('MAX_RECENTLY_COMPARED is 10', () => {
    expect(MAX_RECENTLY_COMPARED).toBe(10);
  });

  it('adding an 11th item removes the oldest item', () => {
    let history = [];
    for (let i = 1; i <= 11; i++) {
      history = addEntry(history, [i]);
    }
    expect(history).toHaveLength(10);
    // newest (id=11) should be first, oldest (id=1) should be gone
    expect(history[0].productIds).toEqual([11]);
    expect(history.some(e => e.productIds[0] === 1)).toBe(false);
  });

  it('persists capped list to localStorage', () => {
    let history = [];
    for (let i = 1; i <= 11; i++) {
      history = addEntry(history, [i]);
    }
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY));
    expect(stored).toHaveLength(10);
  });
});
