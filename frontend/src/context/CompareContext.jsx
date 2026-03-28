import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const CompareContext = createContext(null);

export function CompareProvider({ children }) {
  const [products, setProducts] = useState([]);
  const location = useLocation();

  useEffect(() => {
    const allowed = location.pathname.startsWith('/marketplace') || location.pathname.startsWith('/compare');
    if (!allowed && products.length > 0) {
      setProducts([]);
    }
  }, [location.pathname, products.length]);

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

  const clearProducts = useCallback(() => setProducts([]), []);

  const isCompared = useCallback((productId) => {
    return products.some(p => p.id === productId);
  }, [products]);

  return (
    <CompareContext.Provider value={{ products, addProduct, removeProduct, toggleProduct, clearProducts, isCompared }}>
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  return useContext(CompareContext);
}
