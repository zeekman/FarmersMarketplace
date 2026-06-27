import { useState, useEffect, useRef } from 'react';

const REFRESH_MS = 60_000;

/**
 * Fetches XLM exchange rates from /api/rates.
 *
 * Returns:
 *   { rates, fetched_at, stale, loading, error }
 *
 * `stale: true` means the backend served cached data past its TTL.
 * The component should display a "Rate may be outdated" warning in that case.
 */
export function useXlmRate(currencies = ['USD']) {
  const [state, setState] = useState({ rates: null, fetched_at: null, stale: false, loading: true, error: null });
  const timerRef = useRef(null);

  const currency = currencies.join(',');

  async function load() {
    try {
      const res = await fetch(`/api/rates?currency=${encodeURIComponent(currency)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch rates');
      setState({ rates: data.rates, fetched_at: data.fetched_at, stale: data.stale, loading: false, error: null });
    } catch (err) {
      setState(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  return state;
}
