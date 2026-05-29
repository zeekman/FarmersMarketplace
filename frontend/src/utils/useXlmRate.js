import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Returns { rate, usd } where usd(xlmAmount) => formatted string like "≈ $0.12"
export function useXlmRate() {
  const [rate, setRate] = useState(null);

  useEffect(() => {
    api.getXlmRate().then(res => setRate(res.rate)).catch(() => {});
  }, []);

  function usd(xlm) {
    if (!rate) return null;
    return `≈ $${(xlm * rate).toFixed(2)}`;
  }

  return { rate, usd };
}
