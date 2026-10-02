import React, { createContext, useState, useRef, useCallback } from 'react';

export const LoadingContext = createContext();

// Delay before the global overlay appears. Short user-initiated requests
// (and background polling) should never flash the overlay; page-level
// skeletons are preferred for those cases.
const SHOW_DELAY_MS = 300;

// Minimum time the overlay stays visible once shown, to avoid flicker.
const MIN_DISPLAY_MS = 300;

export function LoadingProvider({ children }) {
  const [loading, setLoading] = useState(false);
  const countRef = useRef(0);
  const showTimerRef = useRef(null);
  const minMetRef = useRef(false);
  const minTimerRef = useRef(null);

  const startLoading = useCallback(() => {
    countRef.current += 1;
    if (countRef.current === 1) {
      // First concurrent caller — wait before showing the overlay so quick
      // requests (and background work) don't cause a flash.
      clearTimeout(showTimerRef.current);
      clearTimeout(minTimerRef.current);
      minMetRef.current = false;
      showTimerRef.current = setTimeout(() => {
        // Only show if the request is still in flight after the delay.
        if (countRef.current === 0) return;
        setLoading(true);
        minTimerRef.current = setTimeout(() => {
          minMetRef.current = true;
          // If all callers have already finished, hide now
          if (countRef.current === 0) setLoading(false);
        }, MIN_DISPLAY_MS);
      }, SHOW_DELAY_MS);
    }
  }, []);

  const stopLoading = useCallback(() => {
    if (countRef.current <= 0) return;
    countRef.current -= 1;
    if (countRef.current === 0) {
      // All callers finished. If the overlay never appeared, cancel the
      // pending show timer so it doesn't flash after the fact.
      clearTimeout(showTimerRef.current);
      if (minMetRef.current) {
        // Minimum time already satisfied — hide immediately
        setLoading(false);
      }
      // If minMetRef.current is still false, the minTimer will fire and check
      // countRef.current at that point, then hide.
    }
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
