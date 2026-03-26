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
        if (token) {
          // Fetch user info from the token payload (decode without verify — server already verified)
          const payload = JSON.parse(atob(token.split('.')[1]));
          // We only have id + role in the token; restore full user from localStorage if available
          const stored = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
          if (stored && stored.id === payload.id) {
            setUser(stored);
          } else {
            setUser({ id: payload.id, role: payload.role });
          }
        }
      })
      .catch(() => {}) // no cookie or expired — stay logged out
      .finally(() => setLoading(false));
  }, []);

  function login(token, userData) {
    setAccessToken(token);
    localStorage.setItem('user', JSON.stringify(userData)); // store user profile only, NOT the token
    setUser(userData);
  }

  async function logout() {
    try { await api.logout(); } catch { /* best-effort */ }
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
