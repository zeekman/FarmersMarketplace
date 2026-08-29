import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const FavoritesContext = createContext(null);

const lsKey = (userId) => `fm_favorites_${userId}`;
const GUEST_KEY = 'fm_favorites_guest';

function readFromStorage(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const ids = JSON.parse(raw);
    if (Array.isArray(ids)) return new Set(ids);
  } catch { /* ignore */ }
  return null;
}

function writeToStorage(storageKey, favorites) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...favorites]));
  } catch { /* ignore */ }
}

export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'buyer') {
      // Load and maintain guest favorites in localStorage
      const guestFavs = readFromStorage(GUEST_KEY) || new Set();
      setFavorites(guestFavs);
      return;
    }

    // Authenticated: seed from cache immediately so the UI is responsive
    const cached = readFromStorage(lsKey(user.id));
    if (cached) setFavorites(cached);

    setLoading(true);
    api.getFavorites({ limit: 1000 })
      .then(res => {
        const serverIds = new Set((res.data || []).map(p => p.id));

        // Merge any guest favorites accumulated while unauthenticated
        const guestFavs = readFromStorage(GUEST_KEY) || new Set();
        const merged = new Set([...serverIds, ...guestFavs]);

        // Fire-and-forget: push guest-only IDs to the server
        const toSync = [...guestFavs].filter(id => !serverIds.has(id));
        Promise.all(toSync.map(id => api.addFavorite(id).catch(() => {})));

        try { localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }

        setFavorites(merged);
        writeToStorage(lsKey(user.id), merged);
      })
      .catch(() => {
        if (!cached) setFavorites(new Set());
      })
      .finally(() => setLoading(false));
  }, [user]);

  const toggleFavorite = useCallback(async (productId) => {
    // Guest (unauthenticated) path — persist to guest localStorage only
    if (!user || user.role !== 'buyer') {
      setFavorites(prev => {
        const next = new Set(prev);
        if (next.has(productId)) {
          next.delete(productId);
        } else {
          next.add(productId);
        }
        writeToStorage(GUEST_KEY, next);
        return next;
      });
      return;
    }

    const isFavorited = favorites.has(productId);
    const optimistic = new Set(favorites);

    if (isFavorited) {
      optimistic.delete(productId);
    } else {
      optimistic.add(productId);
    }

    // Optimistic update
    setFavorites(optimistic);
    writeToStorage(lsKey(user.id), optimistic);

    try {
      if (isFavorited) {
        await api.removeFavorite(productId);
      } else {
        await api.addFavorite(productId);
      }
    } catch (err) {
      // Revert on error
      setFavorites(favorites);
      writeToStorage(lsKey(user.id), favorites);
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
