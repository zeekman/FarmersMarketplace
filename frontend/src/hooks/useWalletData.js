import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { toast } from '../utils/toast';

/** Wallet balance and transaction history. */
export function useWalletData() {
  const [wallet, setWallet]       = useState(null);
  const [txs, setTxs]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [w, txData] = await Promise.all([api.getWallet(), api.getTransactions()]);
      setWallet(w);
      setTxs(txData.data ?? txData);
    } catch (e) {
      const msg = getStellarErrorMessage(e) || getErrorMessage(e);
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Background refresh after an incoming payment; failures are silent
  const refreshTransactions = useCallback(() => {
    api.getTransactions().then(t => setTxs(t.data ?? t)).catch(() => {});
  }, []);

  return { wallet, setWallet, txs, loading, loadError, load, refreshTransactions };
}
