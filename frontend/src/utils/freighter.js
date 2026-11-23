import { useCallback, useEffect, useState } from 'react';
import * as freighterApi from '@stellar/freighter-api';

// Non-custodial wallet support (FE-15). Everything here degrades to
// "not installed" so callers can fall back to the custodial flow.
const STORAGE_KEY = 'freighter_public_key';

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

// Freighter API v6 reports failures as `{ error }` instead of throwing; turn them back into exceptions.
function unwrap(res) {
  if (res?.error) throw new Error(res.error.message ?? res.error);
  return res;
}

export async function isFreighterInstalled() {
  try {
    return Boolean(unwrap(await freighterApi.isConnected()).isConnected);
  } catch {
    return false;
  }
}

/** Maps the app's network name ('testnet' | 'mainnet') to Freighter's ('TESTNET' | 'PUBLIC'). */
export function toFreighterNetwork(appNetwork) {
  return appNetwork === 'mainnet' ? 'PUBLIC' : 'TESTNET';
}

export async function connectFreighter() {
  if (!(await isFreighterInstalled())) throw new Error('Freighter extension is not installed');
  const { address: publicKey } = unwrap(await freighterApi.requestAccess());
  if (!publicKey) throw new Error('Freighter did not return a public key');
  const details = unwrap(await freighterApi.getNetworkDetails());
  writeStored(publicKey);
  return { publicKey, network: details.network, networkPassphrase: details.networkPassphrase };
}

export function disconnectFreighter() {
  writeStored(null);
}

export async function signWithFreighter(xdr, networkPassphrase) {
  const { signedTxXdr: signed } = unwrap(await freighterApi.signTransaction(xdr, { networkPassphrase }));
  if (!signed) throw new Error('Transaction was not signed');
  return signed;
}

/**
 * React hook exposing the Freighter connection: { installed, publicKey, network,
 * mismatch, connect, disconnect }. `mismatch` is true when Freighter is on a
 * different network from the app, which must block payments.
 */
export function useFreighter(appNetwork) {
  const [installed, setInstalled] = useState(null);
  const [publicKey, setPublicKey] = useState(readStored);
  const [network, setNetwork] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await isFreighterInstalled();
      if (cancelled) return;
      setInstalled(ok);
      if (ok && readStored()) {
        try {
          const details = unwrap(await freighterApi.getNetworkDetails());
          if (!cancelled) setNetwork(details.network || null);
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const connect = useCallback(async () => {
    setError('');
    try {
      const res = await connectFreighter();
      setPublicKey(res.publicKey);
      setNetwork(res.network || null);
      setInstalled(true);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectFreighter();
    setPublicKey(null);
    setNetwork(null);
  }, []);

  const connected = Boolean(installed && publicKey);
  const mismatch = Boolean(connected && network && appNetwork && network !== toFreighterNetwork(appNetwork));
  return { installed, connected, publicKey: connected ? publicKey : null, network, mismatch, error, connect, disconnect };
}
