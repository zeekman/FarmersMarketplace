import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, setAccessToken, clearAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // wait for silent refresh on mount

  // On mount: attempt silent refresh to restore session from HttpOnly cookie
  useEffect(() => {
    api.refresh()
      .then((token) => {
        if (!token) return;
        return api.getCurrentUser()
          .then((profile) => {
            setUser(profile);
            localStorage.setItem('user', JSON.stringify(profile));
          });
      })
      .catch(() => {}) // no cookie, expired, or profile fetch failed — stay logged out
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const urlB64ToUint8Array = (base64String) => {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const output = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
      return output;
    };

    const subscribe = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const reg = await navigator.serviceWorker.ready;
        let subscription = await reg.pushManager.getSubscription();
        if (!subscription) {
          const keyRes = await api.getPushPublicKey();
          const publicKey = keyRes?.data?.publicKey;
          if (!publicKey) return;
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(publicKey),
          });
        }

        await api.subscribePush(subscription);
      } catch {
        // Best effort only; auth should not fail because push setup failed.
      }
    };

    subscribe();
  }, [user]);

  function login(token, userData) {
    setAccessToken(token);
    localStorage.setItem('user', JSON.stringify(userData)); // store user profile only, NOT the token
    setUser(userData);
  }

  async function logout() {
    try {
      await api.unsubscribePush().catch(() => {});
      await api.logout();
    } catch {
      /* best-effort */
    }
    clearAccessToken();
    localStorage.removeItem('user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
