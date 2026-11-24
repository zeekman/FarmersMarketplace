import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Returns { rate, usd, fiat } where usd(xlmAmount) => formatted string like "≈ $0.12"
// and fiat(xlmAmount, currency) => formatted string like "≈ KES 123.45".
export function useXlmRate() {
  const [rate, setRate] = useState(null);

  useEffect(() => {
    const fetch = () =>
      api.getMarketRate().then(res => setRate(res.midPrice ?? null)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 60000);
    return () => clearInterval(id);
  }, []);

  function usd(xlm) {
    if (!rate) return null;
    return `≈ $${(xlm * rate).toFixed(2)}`;
  }

  // Fiat equivalent in the given currency. Uses the same mid-price rate as usd().
  // Returns null when the rate is unavailable or the amount is not a finite number.
  function fiat(xlm, currency = 'USD') {
    const amount = Number(xlm);
    if (!rate || !Number.isFinite(amount)) return null;
    const value = (amount * rate).toFixed(2);
    return `≈ ${currency} ${value}`;
  }

  return { rate, usd, fiat };
}
