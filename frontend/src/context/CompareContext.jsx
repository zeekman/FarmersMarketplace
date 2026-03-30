import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const CompareContext = createContext(null);

const HISTORY_KEY = 'comparison_history';
const MAX_HISTORY = 5;

export function CompareProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);
  const location = useLocation();

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load comparison history:', e);
    }
  }, []);

  useEffect(() => {
    const allowed = location.pathname.startsWith('/marketplace') || location.pathname.startsWith('/compare');
    if (!allowed && products.length > 0) {
      setProducts([]);
    }
  }, [location.pathname, products.length]);

  const saveToHistory = useCallback((productIds) => {
    if (!productIds || productIds.length === 0) return;

    setHistory(prev => {
      // Create new history entry with product IDs
      const newEntry = {
        id: Date.now(),
        productIds,
        timestamp: new Date().toISOString(),
      };

      // Keep only last 5 comparisons
      const updated = [newEntry, ...prev].slice(0, MAX_HISTORY);
      
      // Persist to localStorage
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save comparison history:', e);
      }

      return updated;
    });
  }, []);

  const addProduct = useCallback((product) => {
    setProducts(prev => {
      if (prev.some(p => p.id === product.id)) return prev;
      const next = [...prev, product];
      return next.length > 3 ? next.slice(1) : next;
    });
  }, []);

  const removeProduct = useCallback((productId) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
  }, []);

  const toggleProduct = useCallback((product) => {
    setProducts(prev => {
      const exists = prev.some(p => p.id === product.id);
      if (exists) return prev.filter(p => p.id !== product.id);
      const next = [...prev, product];
      return next.length > 3 ? next.slice(1) : next;
    });
  }, []);

  const clearProducts = useCallback(() => {
    setProducts([]);
  }, []);

  const restoreComparison = useCallback((historyEntry) => {
    // Restore comparison from history (product IDs will be fetched by parent)
    return historyEntry.productIds;
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (e) {
      console.error('Failed to clear comparison history:', e);
    }
  }, []);

  const isCompared = useCallback((productId) => {
    return products.some(p => p.id === productId);
  }, [products]);

  return (
    <CompareContext.Provider value={{
      products,
      history,
      addProduct,
      removeProduct,
      toggleProduct,
      clearProducts,
      saveToHistory,
      restoreComparison,
      clearHistory,
      isCompared,
    }}>
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  return useContext(CompareContext);
}
