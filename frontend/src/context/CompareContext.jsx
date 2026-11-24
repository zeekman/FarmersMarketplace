import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MAX_RECENTLY_COMPARED } from '../components/RecentlyCompared';
import { api } from '../api/client';
import { safeStorage } from '../utils/safeStorage';
import { showToast } from '../utils/toast';

const CompareContext = createContext(null);

const HISTORY_KEY = 'comparison_history';
const SELECTION_KEY = 'compare_selection';
const MAX_COMPARE = 4;

function warnListFull(product) {
  showToast(`Compare list is full (max ${MAX_COMPARE}). Remove a product before adding "${product.name}".`, 'warning');
}

export function CompareProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);
  const location = useLocation();
  const selectionHydrated = useRef(false);

  // Load history from localStorage on mount
  useEffect(() => {
    const stored = safeStorage.getJSON(HISTORY_KEY);
    if (Array.isArray(stored)) setHistory(stored);
  }, []);

  // Rehydrate the persisted selection (IDs only) by fetching current product data
  useEffect(() => {
    const ids = safeStorage.getJSON(SELECTION_KEY, []);
    if (!Array.isArray(ids) || ids.length === 0) {
      selectionHydrated.current = true;
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.slice(0, MAX_COMPARE).map((id) =>
        api.getProduct(id)
          .then((res) => res?.data ?? { id, name: `Product ${id}`, unavailable: true })
          .catch(() => ({ id, name: 'No longer available', unavailable: true }))
      )
    ).then((restored) => {
      if (cancelled) return;
      selectionHydrated.current = true;
      setProducts(restored);
    });
    return () => { cancelled = true; };
  }, []);

  // Persist only once rehydration has run, so mount never overwrites the stored selection
  useEffect(() => {
    if (!selectionHydrated.current) return;
    safeStorage.setJSON(SELECTION_KEY, products.map((p) => p.id));
  }, [products]);

  useEffect(() => {
    const allowed =
      location.pathname.startsWith('/marketplace') || location.pathname.startsWith('/compare');
    if (!allowed && products.length > 0) {
      setProducts([]);
    }
  }, [location.pathname, products.length]);

  const saveToHistory = useCallback((productIds) => {
    if (!productIds || productIds.length === 0) return;

    setHistory((prev) => {
      // Create new history entry with product IDs
      const newEntry = {
        id: Date.now(),
        productIds,
        timestamp: new Date().toISOString(),
      };

      // Keep only last MAX_RECENTLY_COMPARED comparisons
      const updated = [newEntry, ...prev].slice(0, MAX_RECENTLY_COMPARED);

      safeStorage.setJSON(HISTORY_KEY, updated);

      return updated;
    });
  }, []);

  const addProduct = useCallback((product) => {
    if (products.some((p) => p.id === product.id)) return;
    if (products.length >= MAX_COMPARE) return warnListFull(product);
    setProducts((prev) => [...prev, product]);
  }, [products]);

  const removeProduct = useCallback((productId) => {
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  }, []);

  const toggleProduct = useCallback((product) => {
    if (products.some((p) => p.id === product.id)) {
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      return;
    }
    if (products.length >= MAX_COMPARE) return warnListFull(product);
    setProducts((prev) => [...prev, product]);
  }, [products]);

  const clearProducts = useCallback(() => {
    setProducts([]);
  }, []);

  const restoreComparison = useCallback((historyEntry) => {
    // Restore comparison from history (product IDs will be fetched by parent)
    return historyEntry.productIds;
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    safeStorage.remove(HISTORY_KEY);
  }, []);

  const removeProductsFromHistory = useCallback((productIds) => {
    const unavailableIds = new Set(productIds);
    setHistory((prev) => {
      const updated = prev
        .map((entry) => ({
          ...entry,
          productIds: entry.productIds.filter((id) => !unavailableIds.has(id)),
        }))
        .filter((entry) => entry.productIds.length > 0);
      safeStorage.setJSON(HISTORY_KEY, updated);
      return updated;
    });
  }, []);

  const isCompared = useCallback(
    (productId) => {
      return products.some((p) => p.id === productId);
    },
    [products]
  );

  return (
    <CompareContext.Provider
      value={{
        products,
        history,
        addProduct,
        removeProduct,
        toggleProduct,
        clearProducts,
        saveToHistory,
        restoreComparison,
        clearHistory,
        removeProductsFromHistory,
        isCompared,
      }}
    >
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  return useContext(CompareContext);
}
