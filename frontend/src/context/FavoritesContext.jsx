import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const FavoritesContext = createContext(null);

export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const [loading, setLoading] = useState(false);

  // Load favorites on mount or when user changes
  useEffect(() => {
    if (!user || user.role !== 'buyer') {
      setFavorites(new Set());
      return;
    }

    setLoading(true);
    api.getFavorites({ limit: 1000 })
      .then(res => {
        const ids = new Set((res.data || []).map(p => p.id));
        setFavorites(ids);
      })
      .catch(() => setFavorites(new Set()))
      .finally(() => setLoading(false));
  }, [user]);

  const toggleFavorite = useCallback(async (productId) => {
    if (!user || user.role !== 'buyer') return;

    const isFavorited = favorites.has(productId);
    const newFavorites = new Set(favorites);

    try {
      if (isFavorited) {
        newFavorites.delete(productId);
        setFavorites(newFavorites);
        await api.removeFavorite(productId);
      } else {
        newFavorites.add(productId);
        setFavorites(newFavorites);
        await api.addFavorite(productId);
      }
    } catch (err) {
      // Revert on error
      setFavorites(favorites);
      throw err;
    }
  }, [user, favorites]);

  const isFavorited = useCallback((productId) => {
    return favorites.has(productId);
  }, [favorites]);

  return (
    <FavoritesContext.Provider value={{ favorites, loading, toggleFavorite, isFavorited }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  return useContext(FavoritesContext);
}
