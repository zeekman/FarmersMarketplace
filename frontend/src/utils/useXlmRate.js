import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Returns { rate, usd } where usd(xlmAmount) => formatted string like "≈ $0.12"
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

  return { rate, usd };
}
