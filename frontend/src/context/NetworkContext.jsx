import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const NetworkContext = createContext({
  network: null,
  expectedNetwork: null,
  mismatch: false,
  explorerUrl: (type, id) => `https://stellar.expert/explorer/testnet/${type}/${id}`,
});

const BUILD_NETWORK = (import.meta.env && import.meta.env.VITE_STELLAR_NETWORK) || null;

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

export function NetworkProvider({ children }) {
  const [network, setNetwork] = useState(null);
  const [expectedNetwork] = useState(() => normalize(BUILD_NETWORK));
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getNetwork()
      .then(res => {
        if (cancelled) return;
        const reported = normalize(res && res.network);
        setNetwork(reported);
        if (expectedNetwork && reported && reported !== expectedNetwork) {
          setMismatch(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [expectedNetwork]);

  const explorerUrl = (type, id) =>
    `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/${type}/${encodeURIComponent(id)}`;

  return (
    <NetworkContext.Provider value={{ network, expectedNetwork, mismatch, explorerUrl }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
