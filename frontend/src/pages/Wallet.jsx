import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { toast } from '../utils/toast';
import { useConfirm } from '../hooks/useConfirm';
import { useXlmRate } from '../utils/useXlmRate';
import { useNetwork } from '../context/NetworkContext';
import { safeStorage } from '../utils/safeStorage';
import {
  classifyDestination,
  validateMemo,
  memoByteLength,
  isValidAmount,
  getExchangeName,
  maxSendable,
  MEMO_TYPES,
} from '../utils/stellarAddress';

const DISCLAIMER_KEY = 'testnet_disclaimer_dismissed';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

const COMMON_ASSETS = [
  { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', label: 'USDC (Circle)' },
  { code: 'AQUA', issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA', label: 'AQUA' },
];

const s = {
  page:             { maxWidth: 800, margin: '0 auto', padding: 16 },
  title:            { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card:             { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  disclaimer:       { background: '#fff8e1', border: '1px solid #f9a825', borderRadius: 10, padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' },
  disclaimerIcon:   { fontSize: 20, flexShrink: 0, marginTop: 1 },
  disclaimerBody:   { flex: 1, fontSize: 13, color: '#5d4037', lineHeight: 1.5 },
  disclaimerTitle:  { fontWeight: 700, fontSize: 14, marginBottom: 3, color: '#e65100' },
  disclaimerDismiss:{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 },
  balance:          { fontSize: 40, fontWeight: 700, color: '#2d6a4f' },
  key:              { fontSize: 12, color: '#888', wordBreak: 'break-all', marginTop: 8, fontFamily: 'monospace' },
  btn:              { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 16, minHeight: 44 },
  btnSm:            { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnDanger:        { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnOutline:       { background: '#fff', color: '#2d6a4f', border: '1px solid #2d6a4f', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  tx:               { borderBottom: '1px solid #eee', padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sent:             { color: '#c0392b', fontWeight: 600 },
  recv:             { color: '#2d6a4f', fontWeight: 600 },
  hash:             { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 },
  msg:              { padding: '10px 14px', borderRadius: 8, marginTop: 12, fontSize: 14 },
  label:            { display: 'block', fontSize: 13, color: '#555', marginBottom: 4, marginTop: 14 },
  input:            { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', minHeight: 44 },
  row:              { display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 16 },
  assetRow:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' },
  assetCode:        { fontWeight: 700, fontSize: 15, color: '#2d6a4f' },
  assetBal:         { fontSize: 14, color: '#333', fontWeight: 600 },
  assetIssuer:      { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 },
};

if (typeof document !== 'undefined' && !document.getElementById('wallet-toast-style')) {
  const style = document.createElement('style');
  style.id = 'wallet-toast-style';
  style.textContent = '@keyframes slideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

import { useWalletData } from '../hooks/useWalletData';
import { useWalletAlerts } from '../hooks/useWalletAlerts';
import { useClaimableBalances } from '../hooks/useClaimableBalances';
import { useWalletStream } from '../hooks/useWalletStream';
import { useWalletStreams } from '../hooks/useWalletStreams';
import { useTrustlines } from '../hooks/useTrustlines';
import { useWalletSend } from '../hooks/useWalletSend';
import { useWalletBudget } from '../hooks/useWalletBudget';
import { s } from '../components/wallet/walletStyles';
import TestnetDisclaimer from '../components/wallet/TestnetDisclaimer';
import WalletBalanceCard from '../components/wallet/WalletBalanceCard';
import RewardTokenCard from '../components/wallet/RewardTokenCard';
import ClaimableBalances from '../components/wallet/ClaimableBalances';
import BudgetPanel from '../components/wallet/BudgetPanel';
import TrustlinePanel from '../components/wallet/TrustlinePanel';
import SendForm from '../components/wallet/SendForm';
import AlertsPanel from '../components/wallet/AlertsPanel';
import PaymentStreams from '../components/wallet/PaymentStreams';
import FreighterConnect from '../components/wallet/FreighterConnect';
import TransactionHistory from '../components/wallet/TransactionHistory';

export default function Wallet() {
  const { confirm, confirmDialog } = useConfirm();
  const { user } = useAuth();
  const { network, explorerUrl } = useNetwork();
  const { usd } = useXlmRate();
  const [disclaimerVisible, setDisclaimerVisible] = useState(() => safeStorage.get(DISCLAIMER_KEY) !== 'true');
  const [wallet, setWallet]       = useState(null);
  const [txs, setTxs]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [funding, setFunding]     = useState(false);
  const [fundMsg, setFundMsg]     = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [budget, setBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetMsg, setBudgetMsg] = useState(null);

  const EMPTY_SEND = { destination: '', amount: '', memo: '', memoType: 'text', totp: '' };
  const [sendForm, setSendForm]   = useState(EMPTY_SEND);
  const [sending, setSending]     = useState(false);
  const [sendMsg, setSendMsg]     = useState(null);
  // Review step: { publicKey, federation, exists, memo, memoType, amount }
  const [sendReview, setSendReview] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const { wallet, setWallet, txs, loading, loadError, load: loadWallet, refreshTransactions } = useWalletData();
  const { alerts, unreadCount, loadAlerts, markAlertRead } = useWalletAlerts();
  const handleBalance = useCallback((balance) => {
    setWallet(prev => prev ? { ...prev, balance } : prev);
  }, [setWallet]);
  const { claimableBalances, claimableLoading, claimingId, loadClaimables, claim } = useClaimableBalances({ onBalance: handleBalance });

  const load = useCallback(async () => {
    await loadWallet();
    loadAlerts();
    loadClaimables();
  }, [loadWallet, loadAlerts, loadClaimables]);

  const streamsApi = useWalletStreams({ onWithdrawn: load });
  const trustlines = useTrustlines({ confirm, onChanged: load });
  const { budget, budgetInput, setBudgetInput, budgetMsg, saveBudget } = useWalletBudget({ enabled: user?.role === 'buyer' });

  const availableBalance = wallet ? (wallet.availableBalance ?? Math.max(0, wallet.balance - 1)) : 0;
  const send = useWalletSend({ availableBalance, onSent: load });

  const handlePayment = useCallback((payload) => {
    if (payload.balance !== null) {
      handleBalance(payload.balance);
    } else {
      load();
    }
    refreshTransactions();
    const xlm = parseFloat(payload.amount);
    const fiat = usd(xlm);
    toast.success(`Payment received: +${xlm.toFixed(2)} XLM${fiat ? ` (${fiat})` : ''} from ${payload.from.slice(0, 8)}...${payload.from.slice(-4)}`);
  }, [handleBalance, load, refreshTransactions, usd]);

  const { reconnecting, sseConnected } = useWalletStream({ onPayment: handlePayment });

  useEffect(() => {
    load();
    streamsApi.loadStreams();
  }, [load, streamsApi.loadStreams]);

  async function handleFund() {
    setFunding(true);
    setFundMsg(null);
    try {
      const res = await api.fundWallet();
      setFundMsg({ type: 'ok', text: res.message });
      load();
    } catch (e) {
      const msg = getStellarErrorMessage(e) || getErrorMessage(e);
      setFundMsg({ type: 'err', text: msg });
      toast.error(msg);
    } finally {
      setFunding(false);
    }
  }

  async function handleSaveBudget(e) {
    e.preventDefault();
    if (typeof api.setBudget !== 'function') return;

    setBudgetMsg(null);
    try {
      const value = budgetInput.trim() === '' ? null : parseFloat(budgetInput);
      const res = await api.setBudget(value);
      setBudget(res);
      setBudgetMsg({ type: 'ok', text: 'Monthly budget updated' });
    } catch (e) {
      setBudgetMsg({ type: 'err', text: getErrorMessage(e) });
    }
  }

  const availableBalance = wallet ? (wallet.availableBalance ?? Math.max(0, wallet.balance - 1)) : 0;
  const sendAmount = parseFloat(sendForm.amount);
  const sendExceedsBalance = sendForm.amount !== '' && !isNaN(sendAmount) && sendAmount > availableBalance;
  const memoError = validateMemo(sendForm.memoType, sendForm.memo);
  const exchangeName = getExchangeName(sendReview?.publicKey || sendForm.destination);
  const amountDecimalsError = sendForm.amount !== '' && !isValidAmount(sendForm.amount)
    ? 'Enter a positive amount with at most 7 decimal places.'
    : null;

  useEffect(() => {
    api.get2FAStatus().then(d => setTwoFactorEnabled(!!d?.enabled)).catch(() => {});
  }, []);

  function updateSend(patch) {
    setSendForm(f => ({ ...f, ...patch }));
    setSendReview(null);
  }

  function handleMax() {
    updateSend({ amount: String(maxSendable(availableBalance)) });
  }

  // Step 1: validate, resolve federation, check the destination exists, then show the review screen.
  async function handleReview(e) {
    e.preventDefault();
    setSendMsg(null);
    const destination = sendForm.destination.trim();
    const amount = parseFloat(sendForm.amount);
    if (!destination)
      return setSendMsg({ type: 'err', text: 'Destination address is required.' });
    const kind = classifyDestination(destination);
    if (!kind)
      return setSendMsg({ type: 'err', text: 'Invalid destination. Enter a Stellar public key (G…), muxed address (M…) or federation address (name*domain).' });
    if (!isValidAmount(sendForm.amount))
      return setSendMsg({ type: 'err', text: 'Amount must be greater than 0 with at most 7 decimal places.' });
    if (amount > availableBalance)
      return setSendMsg({ type: 'err', text: `Insufficient balance. You have ${availableBalance.toFixed(7)} XLM available.` });
    if (memoError)
      return setSendMsg({ type: 'err', text: memoError });

    setReviewing(true);
    try {
      let publicKey = destination;
      let memo = sendForm.memo;
      let memoType = sendForm.memoType;
      let federation = null;
      if (kind === 'federation') {
        const res = await api.resolveFederation(destination);
        publicKey = res.publicKey;
        federation = destination;
        // A memo returned by the federation server is required by the recipient.
        if (res.memo && !memo) {
          memo = String(res.memo);
          memoType = /^\d+$/.test(memo) ? 'id' : 'text';
          setSendForm(f => ({ ...f, memo, memoType }));
        }
      }
      const { exists } = await api.checkAccountExists(publicKey);
      if (!exists && publicKey.startsWith('M'))
        return setSendMsg({ type: 'err', text: 'This muxed account does not exist on the network.' });
      if (!exists && amount < 1)
        return setSendMsg({ type: 'err', text: 'This account does not exist yet. Send at least 1 XLM to create it.' });
      setSendReview({ publicKey, federation, exists, memo, memoType, amount: sendForm.amount });
    } catch (err) {
      setSendMsg({ type: 'err', text: getErrorMessage(err) });
    } finally {
      setReviewing(false);
    }
  }

  // Step 2: user confirmed on the review screen.
  async function handleSend() {
    if (!sendReview) return;
    if (twoFactorEnabled && !/^\d{6}$/.test(sendForm.totp))
      return setSendMsg({ type: 'err', text: 'Enter your 6-digit authenticator code.' });
    setSendMsg(null);
    setSending(true);
    try {
      const res = await api.withdrawFunds(sendReview.publicKey, sendReview.amount, {
        ...(sendReview.memo ? { memo: sendReview.memo, memo_type: sendReview.memoType } : {}),
        ...(twoFactorEnabled ? { totp: sendForm.totp } : {}),
      });
      setSendMsg({
        type: 'ok',
        text: `Sent ${res.amount} XLM${res.created ? ' and created the destination account' : ''}`,
        txHash: res.txHash,
      });
      setSendForm(EMPTY_SEND);
      setSendReview(null);
      load();
    } catch (e) {
      if (e.code === 'totp_required') setTwoFactorEnabled(true);
      setSendMsg({ type: 'err', text: getErrorMessage(e) });
    } finally {
      setSending(false);
    }
  }


  async function handleAddTrustline(assetCode, assetIssuer) {
    setTlLoading(true);
    setTlMsg(null);
    try {
      await api.addTrustline({ asset_code: assetCode, asset_issuer: assetIssuer });
      setTlMsg({ type: 'ok', text: 'Trustline for ' + assetCode + ' added.' });
      setShowTrustlineForm(false);
      setTlForm({ asset_code: '', asset_issuer: '' });
      load();
    } catch (e) {
      setTlMsg({ type: 'err', text: getErrorMessage(e) });
    } finally {
      setTlLoading(false);
    }
  }

  async function handleRemoveTrustline(assetCode, assetIssuer) {
    const ok = await confirm({
      title: 'Remove trustline for ' + assetCode + '?',
      description: 'You must have a zero balance of this asset before removing its trustline.',
      confirmLabel: 'Remove trustline',
      destructive: true,
    });
    if (!ok) return;
    setRemovingAsset(assetCode);
    setTlMsg(null);
    try {
      await api.removeTrustline({ asset_code: assetCode, asset_issuer: assetIssuer });
      setTlMsg({ type: 'ok', text: 'Trustline for ' + assetCode + ' removed.' });
      load();
    } catch (e) {
      setTlMsg({ type: 'err', text: getErrorMessage(e) });
    } finally {
      setRemovingAsset(null);
    }
  }

  async function handleCancelStream(id) {
    setStreamActionId(id);
    setStreamsMsg(null);
    try {
      await api.cancelPaymentStream(id);
      setStreamsMsg({ type: 'ok', text: 'Stream canceled.' });
      loadStreams();
    } catch (e) {
      setStreamsMsg({ type: 'err', text: getStellarErrorMessage(e) || getErrorMessage(e) });
    } finally {
      setStreamActionId(null);
    }
  }

  async function handleDecreaseStreamRate(id, currentRate) {
    const input = prompt('New rate per second (must be lower than current rate):', currentRate);
    if (input == null) return;
    const rate = parseFloat(input);
    if (!rate || rate <= 0 || rate >= currentRate) {
      setStreamsMsg({ type: 'err', text: 'New rate must be a positive number lower than the current rate.' });
      return;
    }
    setStreamActionId(id);
    setStreamsMsg(null);
    try {
      await api.decreasePaymentStreamRate(id, rate);
      setStreamsMsg({ type: 'ok', text: 'Stream rate decreased.' });
      loadStreams();
    } catch (e) {
      setStreamsMsg({ type: 'err', text: getStellarErrorMessage(e) || getErrorMessage(e) });
    } finally {
      setStreamActionId(null);
    }
  }

  async function handleWithdrawStream(id) {
    setStreamActionId(id);
    setStreamsMsg(null);
    try {
      const res = await api.withdrawPaymentStream(id);
      setStreamsMsg({ type: 'ok', text: `Withdrew ${res.amount ?? ''} from stream.`.trim() });
      loadStreams();
      load();
    } catch (e) {
      setStreamsMsg({ type: 'err', text: getStellarErrorMessage(e) || getErrorMessage(e) });
    } finally {
      setStreamActionId(null);
    }
  }

  async function handleClaim(balanceId) {
    setClaimingId(balanceId);
    try {
      const res = await api.claimBalance(balanceId);
      toast.success('Balance claimed successfully!');
      // Update wallet balance immediately with the returned value
      if (res.balance != null) {
        setWallet(prev => prev ? { ...prev, balance: res.balance } : prev);
      }
      // Remove the claimed balance from the list
      setClaimableBalances(prev => prev.filter(b => b.id !== balanceId));
    } catch (e) {
      const msg = getErrorMessage(e);
      toast.error(msg);
    } finally {
      setClaimingId(null);
    }
  }

  const customBalances = (wallet?.balances ?? []).filter(b => b.asset_type !== 'native');

  /** Returns a human-readable description of a Stellar claimant predicate */
  function describeCondition(predicate) {
    if (!predicate || predicate.unconditional) return 'Claimable now';
    if (predicate.not) {
      const inner = predicate.not;
      if (inner.abs_before) {
        return `Claimable after ${new Date(inner.abs_before).toLocaleString()}`;
      }
      if (inner.rel_before) {
        const days = Math.round(inner.rel_before / 86400);
        return `Claimable after ~${days} day${days !== 1 ? 's' : ''}`;
      }
    }
    if (predicate.abs_before) {
      return `Claimable until ${new Date(predicate.abs_before).toLocaleString()}`;
    }
    return 'Conditional';
  }

  return (
    <div className="wallet-page" style={s.page}>
      <Helmet>
        <title>My Wallet – Farmers Marketplace</title>
        <meta name="description" content="Manage your Stellar XLM wallet, view balance and transaction history." />
      </Helmet>
      <div style={s.title}>My Wallet</div>

      {reconnecting && (
        <div role="status" style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-strong)', borderRadius: 8, padding: '8px 14px', marginBottom: 16, fontSize: 13, color: 'var(--color-warning-text)' }}>
          ⟳ Reconnecting to live updates…
        </div>
      )}

      {/* SSE connection indicator */}
      <div
        role="status"
        aria-label={sseConnected ? 'Live updates connected' : 'Live updates disconnected'}
        title={sseConnected ? 'Live updates connected' : 'Live updates disconnected'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sseConnected ? 'var(--color-primary)' : 'var(--color-text-faint)' }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: sseConnected ? 'var(--color-success)' : 'var(--color-text-subtle)',
            display: 'inline-block',
            boxShadow: sseConnected ? '0 0 0 3px var(--color-primary-soft)' : 'none',
            transition: 'background 0.3s, box-shadow 0.3s',
          }}
        />
        {sseConnected ? 'Live' : 'Offline'}
      </div>

      {network !== 'mainnet' && <TestnetDisclaimer />}

      {network === 'mainnet' && (
        <div style={{ background: 'var(--color-danger)', color: 'var(--color-on-primary)', borderRadius: 10, padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }} role="alert">
          <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Mainnet — Real Funds</div>
            You are connected to <strong>Stellar Mainnet</strong>. All transactions use <strong>real XLM</strong> with real monetary value. Proceed with caution.
          </div>
        </div>
      )}

      {loadError && (
        <div style={{ ...s.msg, background: 'var(--color-danger-soft)', color: 'var(--color-danger)', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{loadError}</span>
          <button style={{ background: 'var(--color-danger)', color: 'var(--color-on-primary)', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }} onClick={load}>Retry</button>
        </div>
      )}

      {loading && !loadError ? <Spinner /> : (
        <>
          {user?.role === 'buyer' && <RewardTokenCard />}
          <WalletBalanceCard
            wallet={wallet}
            usd={usd}
            network={network}
            funding={funding}
            fundMsg={fundMsg}
            onFund={handleFund}
          />

          <ClaimableBalances
            balances={claimableBalances}
            loading={claimableLoading}
            claimingId={claimingId}
            onClaim={claim}
          />

          {user?.role === 'buyer' && (
            <BudgetPanel
              budget={budget}
              budgetInput={budgetInput}
              setBudgetInput={setBudgetInput}
              budgetMsg={budgetMsg}
              onSave={saveBudget}
            />
          )}

          <FreighterConnect />

          <TrustlinePanel wallet={wallet} trustlines={trustlines} />

          <SendForm send={send} availableBalance={availableBalance} explorerUrl={explorerUrl} />

          <div style={s.card}>
            <h3 style={{ marginBottom: 4, color: '#333' }}>Withdraw XLM</h3>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Transfer XLM from your platform wallet to a Stellar public key, muxed address or federation address.</p>
            <form onSubmit={handleReview} noValidate>
              <label style={s.label} htmlFor="send-destination">Destination Address</label>
              <input
                id="send-destination"
                style={s.input} type="text" placeholder="G…, M… or name*domain" spellCheck={false} autoComplete="off"
                value={sendForm.destination}
                onChange={e => updateSend({ destination: e.target.value })}
              />
              <label style={s.label} htmlFor="send-amount">Amount (XLM)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="send-amount"
                  style={{ ...s.input, flex: 1, borderColor: sendExceedsBalance || amountDecimalsError ? '#c0392b' : undefined }}
                  type="text" inputMode="decimal" placeholder="0.00"
                  value={sendForm.amount}
                  onChange={e => updateSend({ amount: e.target.value.replace(/[^\d.]/g, '') })}
                  aria-describedby={sendExceedsBalance ? 'send-balance-warning' : undefined}
                />
                <button type="button" style={{ ...s.btn, marginTop: 0, padding: '8px 12px' }} onClick={handleMax} title="Send everything except the reserve and network fee">
                  Max
                </button>
              </div>
              {sendExceedsBalance && (
                <div id="send-balance-warning" role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: 4 }}>
                  Insufficient balance. You have {availableBalance.toFixed(7)} XLM available.
                </div>
              )}
              {!sendExceedsBalance && amountDecimalsError && (
                <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: 4 }}>{amountDecimalsError}</div>
              )}
              <label style={s.label} htmlFor="send-memo">Memo <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  aria-label="Memo type"
                  style={{ ...s.input, width: 100 }}
                  value={sendForm.memoType}
                  onChange={e => updateSend({ memoType: e.target.value })}
                >
                  {MEMO_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
                <input
                  id="send-memo"
                  style={{ ...s.input, flex: 1, borderColor: memoError ? '#c0392b' : undefined }} type="text" spellCheck={false} autoComplete="off"
                  placeholder={sendForm.memoType === 'id' ? 'e.g. 123456789' : sendForm.memoType === 'hash' ? '64 hex characters' : 'e.g. payment for order #42'}
                  value={sendForm.memo}
                  onChange={e => updateSend({ memo: e.target.value })}
                />
              </div>
              {sendForm.memoType === 'text' && (
                <div style={{ fontSize: 12, color: memoError ? '#c0392b' : '#888', marginTop: 4 }}>{memoByteLength(sendForm.memo)}/28 bytes</div>
              )}
              {memoError && sendForm.memoType !== 'text' && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: 4 }}>{memoError}</div>}
              {exchangeName && !sendForm.memo && (
                <div role="alert" style={{ background: '#fff3cd', border: '1px solid #ffc107', color: '#856404', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginTop: 8 }}>
                  ⚠️ This looks like a {exchangeName} deposit address. Exchanges usually require a memo — without one your funds may be lost.
                </div>
              )}
              {!sendReview && (
                <button type="submit" style={{ ...s.btn, opacity: sendExceedsBalance ? 0.5 : 1 }} disabled={reviewing || sendExceedsBalance || !!memoError}>
                  {reviewing ? 'Checking…' : 'Review'}
                </button>
              )}
            </form>
            {sendReview && (
              <div style={{ marginTop: 12, padding: 14, border: '1px solid #ddd', borderRadius: 8, background: '#fafafa' }} aria-label="Confirm withdrawal">
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Confirm withdrawal</div>
                <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                  <div><strong>Amount:</strong> {sendReview.amount} XLM</div>
                  {sendReview.federation && <div><strong>Federation:</strong> {sendReview.federation}</div>}
                  <div style={{ wordBreak: 'break-all' }}><strong>Destination:</strong> {sendReview.publicKey}</div>
                  <div><strong>Memo:</strong> {sendReview.memo ? `${sendReview.memo} (${sendReview.memoType.toUpperCase()})` : 'none'}</div>
                </div>
                {!sendReview.exists && (
                  <div role="alert" style={{ background: '#fff3cd', color: '#856404', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginTop: 8 }}>
                    ⚠️ This account doesn't exist yet. It will be created with {sendReview.amount} XLM as its starting balance.
                  </div>
                )}
                {twoFactorEnabled && (
                  <>
                    <label style={s.label} htmlFor="send-totp">Authenticator code</label>
                    <input
                      id="send-totp" style={s.input} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="123456"
                      value={sendForm.totp}
                      onChange={e => setSendForm(f => ({ ...f, totp: e.target.value.replace(/\D/g, '') }))}
                    />
                  </>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={s.btn} onClick={handleSend} disabled={sending}>
                    {sending ? 'Sending…' : 'Confirm & Send'}
                  </button>
                  <button type="button" style={{ ...s.btn, background: '#888' }} onClick={() => setSendReview(null)} disabled={sending}>
                    Back
                  </button>
                </div>
              </div>
            )}
            {sendMsg && (
              <div style={{ ...s.msg, background: sendMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: sendMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
                {sendMsg.text}
                {sendMsg.txHash && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    TX: <a href={explorerUrl('tx', sendMsg.txHash)} target="_blank" rel="noreferrer" style={{ color: '#2d6a4f', wordBreak: 'break-all' }}>{sendMsg.txHash}</a>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={s.card}>
            <h3 style={{ marginBottom: 4, color: '#333' }}>Referral Program</h3>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>Earn 1 XLM for every friend who joins and places their first order.</p>
            <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 8, border: '1px dashed #ced4da' }}>
              <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Your Referral Code</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#2d6a4f', fontFamily: 'monospace', letterSpacing: 1 }}>
            <h3 style={{ marginBottom: 4, color: 'var(--color-text)' }}>Referral Program</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>Earn 1 XLM for every friend who joins and places their first order.</p>
            <div style={{ background: 'var(--color-surface-muted)', padding: 16, borderRadius: 8, border: '1px dashed var(--color-border-input)' }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Your Referral Code</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)', fontFamily: 'monospace', letterSpacing: 1 }}>
                {wallet?.referralCode || '-'}
              </div>
            </div>
          </div>

          <AlertsPanel alerts={alerts} unreadCount={unreadCount} onMarkRead={markAlertRead} />

          <PaymentStreams
            streams={streamsApi.streams}
            streamsMsg={streamsApi.streamsMsg}
            streamActionId={streamsApi.streamActionId}
            publicKey={wallet?.publicKey}
            streamsApi={streamsApi}
          />

          <TransactionHistory txs={txs} usd={usd} explorerUrl={explorerUrl} />
        </>
      )}
      {confirmDialog}
    </div>
  );
}
