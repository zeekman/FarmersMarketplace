import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const NetworkContext = createContext({
  network: null,
  explorerUrl: (type, id) => `https://stellar.expert/explorer/testnet/${type}/${id}`,
});

export function NetworkProvider({ children }) {
  const [network, setNetwork] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getNetwork()
      .then(res => { if (!cancelled) setNetwork(res.network); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const explorerUrl = (type, id) =>
    `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/${type}/${encodeURIComponent(id)}`;

  return (
    <NetworkContext.Provider value={{ network, explorerUrl }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}