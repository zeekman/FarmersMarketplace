import React, { createContext, useState, useRef, useCallback } from 'react';

export const LoadingContext = createContext();

const MIN_DISPLAY_MS = 300;

export function LoadingProvider({ children }) {
  const [loading, setLoading] = useState(false);
  const countRef = useRef(0);
  const minMetRef = useRef(false);
  const minTimerRef = useRef(null);

  const startLoading = useCallback(() => {
    countRef.current += 1;
    if (countRef.current === 1) {
      // First concurrent caller — show the spinner and start the minimum-display timer
      clearTimeout(minTimerRef.current);
      minMetRef.current = false;
      setLoading(true);
      minTimerRef.current = setTimeout(() => {
        minMetRef.current = true;
        // If all callers have already finished, hide now
        if (countRef.current === 0) setLoading(false);
      }, MIN_DISPLAY_MS);
    }
  }, []);

  const stopLoading = useCallback(() => {
    if (countRef.current <= 0) return;
    countRef.current -= 1;
    if (countRef.current === 0 && minMetRef.current) {
      // All done and minimum time already satisfied — hide immediately
      setLoading(false);
    }
    // If countRef.current === 0 but minMetRef.current is still false, the minTimer
    // will fire and check countRef.current at that point, then hide.
  }, []);

  return (
    <LoadingContext.Provider value={{ loading, startLoading, stopLoading }}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const context = React.useContext(LoadingContext);
  if (!context) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return context;
}
