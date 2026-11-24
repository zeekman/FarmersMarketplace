import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { getErrorMessage } from '../utils/errorMessages';
import { toast } from '../utils/toast';

/** Stellar claimable balances (pre-order and escrow refunds). */
export function useClaimableBalances({ onBalance }) {
  const [claimableBalances, setClaimableBalances] = useState([]);
  const [claimableLoading, setClaimableLoading] = useState(true); // true initially so section shows while loading
  const [claimingId, setClaimingId] = useState(null); // balance_id currently being claimed

  // Non-blocking, failure is silent
  const loadClaimables = useCallback(() => {
    setClaimableLoading(true);
    api.getClaimableBalances()
      .then(res => setClaimableBalances(res.data ?? []))
      .catch(() => setClaimableBalances([]))
      .finally(() => setClaimableLoading(false));
  }, []);

  async function claim(balanceId) {
    setClaimingId(balanceId);
    try {
      const res = await api.claimBalance(balanceId);
      toast.success('Balance claimed successfully!');
      // Update wallet balance immediately with the returned value
      if (res.balance != null) onBalance(res.balance);
      // Remove the claimed balance from the list
      setClaimableBalances(prev => prev.filter(b => b.id !== balanceId));
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setClaimingId(null);
    }
  }

  return { claimableBalances, claimableLoading, claimingId, loadClaimables, claim };
}
