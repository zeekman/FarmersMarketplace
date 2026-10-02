import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext(undefined);

const getInitialTheme = () => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);
  const [useSystemTheme, setUseSystemTheme] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('theme') === null;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    if (!useSystemTheme) {
      window.localStorage.setItem('theme', theme);
    }
  }, [theme, useSystemTheme]);

  useEffect(() => {
    if (!useSystemTheme || typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => setTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [useSystemTheme]);

  const toggleTheme = useCallback(() => {
    setUseSystemTheme(false);
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const isUsingSystemTheme = useSystemTheme;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, useSystemTheme, isUsingSystemTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
