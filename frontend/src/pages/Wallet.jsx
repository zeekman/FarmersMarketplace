import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { getStellarErrorMessage } from '../utils/stellarErrors';
import { getErrorMessage } from '../utils/errorMessages';
import { useTranslation } from 'react-i18next';

const DISCLAIMER_KEY = 'testnet_disclaimer_dismissed';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

const COMMON_ASSETS = [
  { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', label: 'USDC (Circle)' },
  { code: 'AQUA', issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA', label: 'AQUA' },
];

const s = {
  page:    { maxWidth: 800, margin: '0 auto', padding: 24 },
  title:   { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card:    { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  page: { maxWidth: 800, margin: "0 auto", padding: 16 },
  disclaimer: {
    background: '#fff8e1', border: '1px solid #f9a825', borderRadius: 10,
    padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start',
    background: "#fff8e1",
    border: "1px solid #f9a825",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 20,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  disclaimerIcon: { fontSize: 20, flexShrink: 0, marginTop: 1 },
  disclaimerBody: { flex: 1, fontSize: 13, color: "#5d4037", lineHeight: 1.5 },
  disclaimerTitle: {
    fontWeight: 700,
    fontSize: 14,
    marginBottom: 3,
    color: "#e65100",
  },
  disclaimerDismiss: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#999",
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
  },
  title: { fontSize: 24, fontWeight: 700, color: "#2d6a4f", marginBottom: 24 },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 8px #0001",
    marginBottom: 24,
  },
  balance: { fontSize: 40, fontWeight: 700, color: "#2d6a4f" },
  key: {
    fontSize: 12,
    color: "#888",
    wordBreak: "break-all",
    marginTop: 8,
    fontFamily: "monospace",
  },
  btn: {
    background: "#2d6a4f",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    cursor: "pointer",
    fontWeight: 600,
    marginTop: 16,
    minHeight: 44,
  },
  btnDanger: {
    background: "#c0392b",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    cursor: "pointer",
    fontWeight: 600,
  },
  tx: {
    borderBottom: "1px solid #eee",
    padding: "12px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  balance: { fontSize: 40, fontWeight: 700, color: '#2d6a4f' },
  key:     { fontSize: 12, color: '#888', wordBreak: 'break-all', marginTop: 8, fontFamily: 'monospace' },
  btn:     { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 16 },
  btnSm:   { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnDanger: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnOutline: { background: '#fff', color: '#2d6a4f', border: '1px solid #2d6a4f', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  tx:      { borderBottom: '1px solid #eee', padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sent:    { color: '#c0392b', fontWeight: 600 },
  recv:    { color: '#2d6a4f', fontWeight: 600 },
  hash:    { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 },
  msg:     { padding: '10px 14px', borderRadius: 8, marginTop: 12, fontSize: 14 },
  label:   { display: 'block', fontSize: 13, color: '#555', marginBottom: 4, marginTop: 14 },
  input:   { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' },
  disclaimer: { background: '#fff8e1', border: '1px solid #f9a825', borderRadius: 10, padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' },
  disclaimerIcon: { fontSize: 20, flexShrink: 0, marginTop: 1 },
  disclaimerBody: { flex: 1, fontSize: 13, color: '#5d4037', lineHeight: 1.5 },
  disclaimerTitle: { fontWeight: 700, fontSize: 14, marginBottom: 3, color: '#e65100' },
  disclaimerDismiss: { background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 },
  toastContainer: { position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' },
  toast: { background: '#2d6a4f', color: '#fff', borderRadius: 10, padding: '12px 18px', boxShadow: '0 4px 16px #0003', fontSize: 14, minWidth: 260, maxWidth: 360, pointerEvents: 'auto' },
  toastTitle: { fontWeight: 700, marginBottom: 3 },
  toastSub: { fontSize: 12, opacity: 0.85 },
  assetRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' },
  assetCode: { fontWeight: 700, fontSize: 15, color: '#2d6a4f' },
  assetBal: { fontSize: 14, color: '#333', fontWeight: 600 },
  assetIssuer: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 },
  sent: { color: "#c0392b", fontWeight: 600 },
  recv: { color: "#2d6a4f", fontWeight: 600 },
  hash: { fontSize: 11, color: "#aaa", fontFamily: "monospace", marginTop: 2 },
  msg: { padding: "10px 14px", borderRadius: 8, marginTop: 12, fontSize: 14 },
  label: {
    display: "block",
    fontSize: 13,
    color: "#555",
    marginBottom: 4,
    marginTop: 14,
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: 16,
    boxSizing: "border-box",
    minHeight: 44,
  },
  row: { display: "flex", gap: 12, alignItems: "flex-end", marginTop: 16 },
};

if (typeof document !== 'undefined' && !document.getElementById('wallet-toast-style')) {
  const style = document.createElement('style');
  style.id = 'wallet-toast-style';
  style.textContent = '@keyframes slideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }';
  document.head.appendChild(style);
}

function Toast({ toasts }) {
  return (
    <div style={s.toastContainer} aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} style={s.toast} role="status">
          <div style={s.toastTitle}>Payment received</div>
          <div style={s.toastSub}>+{parseFloat(t.amount).toFixed(2)} XLM from {t.from.slice(0, 8)}...{t.from.slice(-4)}</div>
        </div>
      ))}
    </div>
  );
}

export default function Wallet() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [disclaimerVisible, setDisclaimerVisible] = useState(() => !sessionStorage.getItem(DISCLAIMER_KEY));
  const [wallet, setWallet]       = useState(null);
  const [txs, setTxs]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [funding, setFunding]     = useState(false);
  const [fundMsg, setFundMsg]     = useState(null);
  const [toasts, setToasts]       = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [budget, setBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetMsg, setBudgetMsg] = useState(null);

  const [sendForm, setSendForm]   = useState({ destination: '', amount: '', memo: '' });
  const [sending, setSending]     = useState(false);
  const [sendMsg, setSendMsg]     = useState(null);
  const [network, setNetwork]     = useState(null);

  const [showTrustlineForm, setShowTrustlineForm] = useState(false);
  const [tlForm, setTlForm]       = useState({ asset_code: '', asset_issuer: '' });
  const [tlMsg, setTlMsg]         = useState(null);
  const [tlLoading, setTlLoading] = useState(false);
  const [removingAsset, setRemovingAsset] = useState(null);

  const esRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const unmounted = useRef(false);

  function dismissDisclaimer() {
    sessionStorage.setItem(DISCLAIMER_KEY, '1');
    setDisclaimerVisible(false);
  }

  function addToast(payment) {
    const id = Date.now();
    setToasts(prev => [...prev, { id, ...payment }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [w, txData] = await Promise.all([api.getWallet(), api.getTransactions()]);
      setWallet(w);
      setTxs(txData.data ?? txData);
    } catch (e) {
      setLoadError(getStellarErrorMessage(e) || getErrorMessage(e));
    } finally {
      setLoading(false);
    }
    api.getAlerts().then(res => {
      setAlerts(res.data ?? []);
      setUnreadCount(res.unreadCount ?? 0);
    }).catch(() => {});
  }, []);

  const connectStream = useCallback(() => {
    if (unmounted.current || typeof EventSource === 'undefined') return;
    if (typeof api.getWalletStreamUrl !== 'function') return;
    const url = api.getWalletStreamUrl();
    if (!url.includes('token=') || url.endsWith('token=')) {
      reconnectTimer.current = setTimeout(connectStream, 1000);
      return;
    }
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'payment') {
          if (payload.balance !== null) {
            setWallet(prev => prev ? { ...prev, balance: payload.balance } : prev);
          } else {
            load();
          }
          api.getTransactions().then(t => setTxs(t.data ?? t)).catch(() => {});
          addToast({ amount: payload.amount, from: payload.from });
        }
      } catch {}
    };
    es.addEventListener('error', () => {
      es.close();
      esRef.current = null;
      if (unmounted.current) return;
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_MS);
        connectStream();
      }, reconnectDelay.current);
    });
    es.onopen = () => { reconnectDelay.current = RECONNECT_BASE_MS; };
  }, [load]);

  useEffect(() => {
    unmounted.current = false;
    load();
    api.getNetwork().then(res => setNetwork(res.network)).catch(() => {});
    if (user?.role === 'buyer' && typeof api.getBudget === 'function') {
      api.getBudget()
        .then((res) => {
          setBudget(res);
          setBudgetInput(res.budget != null ? String(res.budget) : '');
        })
        .catch(() => {});
    }
    connectStream();
    return () => {
      unmounted.current = true;
      clearTimeout(reconnectTimer.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [load, connectStream]);

  async function handleFund() {
    setFunding(true);
    setFundMsg(null);
    try {
      const res = await api.fundWallet();
      setFundMsg({ type: 'ok', text: res.message });
      load();
    } catch (e) {
      setFundMsg({ type: 'err', text: getStellarErrorMessage(e) || getErrorMessage(e) });
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

  async function handleSend(e) {
    e.preventDefault();
    setSendMsg(null);
    const amount = parseFloat(sendForm.amount);
    if (!sendForm.destination.trim())
      return setSendMsg({ type: 'err', text: 'Destination address is required.' });
    if (!/^G[A-Z2-7]{55}$/.test(sendForm.destination.trim()) && !sendForm.destination.includes('*'))
      return setSendMsg({ type: 'err', text: 'Invalid destination. Enter a Stellar public key (G...) or federation address (name*domain).' });
    if (!amount || amount <= 0)
      return setSendMsg({ type: 'err', text: 'Amount must be greater than 0.' });
    if (sendForm.memo.length > 28)
      return setSendMsg({ type: 'err', text: 'Memo must be 28 characters or fewer.' });
    setSending(true);
    try {
      const res = await api.withdrawFunds(sendForm.destination.trim(), amount);
      setSendMsg({ type: 'ok', text: 'Withdrew ' + res.amount + ' XLM', txHash: res.txHash });
      setSendForm({ destination: '', amount: '', memo: '' });
      load();
    } catch (e) {
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
    if (!confirm('Remove trustline for ' + assetCode + '? You must have a zero balance.')) return;
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

  const customBalances = (wallet?.balances ?? []).filter(b => b.asset_type !== 'native');

  return (
    <div style={s.page}>
      <Helmet>
        <title>My Wallet – Farmers Marketplace</title>
        <meta name="description" content="Manage your Stellar XLM wallet, view balance and transaction history." />
      </Helmet>
      <Toast toasts={toasts} />
      <div style={s.title}>My Wallet</div>

      {disclaimerVisible && network !== 'mainnet' && (
        <div style={s.disclaimer} role="alert">
          <span style={s.disclaimerIcon}>Warning</span>
          <div style={s.disclaimerBody}>
            <div style={s.disclaimerTitle}>Testnet Only - No Real Money</div>
            This wallet uses <strong>Stellar Testnet XLM</strong>, which has <strong>no monetary value</strong> and cannot be exchanged or withdrawn.
          </div>
          <button style={s.disclaimerDismiss} onClick={dismissDisclaimer} aria-label="Dismiss">x</button>
        </div>
      )}

      {network === 'mainnet' && (
        <div style={{ background: '#c0392b', color: '#fff', borderRadius: 10, padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }} role="alert">
          <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Mainnet — Real Funds</div>
            You are connected to <strong>Stellar Mainnet</strong>. All transactions use <strong>real XLM</strong> with real monetary value. Proceed with caution.
          </div>
        </div>
      )}

      {loadError && (
        <div style={{ ...s.msg, background: '#fee', color: '#c0392b', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{loadError}</span>
          <button style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }} onClick={load}>Retry</button>
        </div>
      )}

      {loading && !loadError ? <Spinner /> : (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>XLM Balance</div>
            <div style={s.balance}>{wallet ? wallet.balance.toFixed(2) : '-'} XLM</div>
            <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>
              Available to withdraw: {wallet ? (wallet.availableBalance ?? Math.max(0, wallet.balance - 1)).toFixed(2) : '-'} XLM
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Includes 1.00 XLM base reserve</div>
            <div style={s.key}>{wallet?.publicKey}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>
              <span style={{ background: '#fff3cd', color: '#856404', border: '1px solid #ffc107', borderRadius: 4, padding: '1px 7px', fontWeight: 600, fontSize: 11 }}>TESTNET</span>
              {' '}XLM shown here has no real-world value.
            </div>
            {network !== 'mainnet' && (
              <>
                <button style={s.btn} onClick={handleFund} disabled={funding}>
                  {funding ? 'Funding...' : 'Fund with Testnet XLM'}
                </button>
                {fundMsg && (
                  <div style={{ ...s.msg, background: fundMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: fundMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
                    {fundMsg.text}
                  </div>
                )}
              </>
            )}
          </div>

          {user?.role === 'buyer' && (
            <div style={s.card}>
              <h3 style={{ marginBottom: 12, color: '#333' }}>Monthly Budget</h3>
              <form onSubmit={handleSaveBudget}>
                <label style={s.label}>Budget limit (XLM)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    style={{ ...s.input, marginBottom: 0 }}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Optional"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                  />
                  <button type="submit" style={{ ...s.btn, marginTop: 0, whiteSpace: 'nowrap' }}>Save</button>
                </div>
              </form>

              {budget?.budget != null && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
                    Spent: {Number(budget.spentThisMonth || 0).toFixed(2)} / {Number(budget.budget).toFixed(2)} XLM
                  </div>
                  <div style={{ height: 12, background: '#edf2f7', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Number(budget.percentUsed || 0))}%`,
                        height: '100%',
                        background: Number(budget.percentUsed || 0) >= 80 ? '#c0392b' : '#2d6a4f',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                    Remaining: {Number(budget.remaining || 0).toFixed(2)} XLM
                  </div>
                  {Number(budget.percentUsed || 0) >= 80 && (
                    <div style={{ ...s.msg, background: '#fff3cd', color: '#856404', marginTop: 10 }}>
                      Warning: you have used {Number(budget.percentUsed || 0).toFixed(0)}% of your monthly budget.
                    </div>
                  )}
                </div>
              )}

              {budgetMsg && (
                <div style={{ ...s.msg, background: budgetMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: budgetMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
                  {budgetMsg.text}
                </div>
              )}
            </div>
          )}

          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#333' }}>Asset Balances</h3>
              <button style={s.btnSm} onClick={() => { setShowTrustlineForm(v => !v); setTlMsg(null); }}>
                {showTrustlineForm ? 'Cancel' : '+ Add Trustline'}
              </button>
            </div>

            {tlMsg && (
              <div style={{ ...s.msg, background: tlMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: tlMsg.type === 'ok' ? '#2d6a4f' : '#c0392b', marginBottom: 12 }}>
                {tlMsg.text}
              </div>
            )}

            {showTrustlineForm && (
              <div style={{ background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#2d6a4f', marginBottom: 10 }}>Quick Add</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {COMMON_ASSETS.map(a => (
                    <button key={a.code} style={s.btnOutline} disabled={tlLoading} onClick={() => handleAddTrustline(a.code, a.issuer)}>
                      {a.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>Custom Asset</div>
                <label style={s.label}>Asset Code</label>
                <input
                  style={s.input}
                  placeholder="e.g. USDC"
                  value={tlForm.asset_code}
                  onChange={e => setTlForm(f => ({ ...f, asset_code: e.target.value.toUpperCase() }))}
                  maxLength={12}
                />
                <label style={s.label}>Issuer Address</label>
                <input
                  style={s.input}
                  placeholder="G..."
                  spellCheck={false}
                  value={tlForm.asset_issuer}
                  onChange={e => setTlForm(f => ({ ...f, asset_issuer: e.target.value.trim() }))}
                />
                <button
                  style={{ ...s.btn, marginTop: 12 }}
                  disabled={tlLoading || !tlForm.asset_code || !tlForm.asset_issuer}
                  onClick={() => handleAddTrustline(tlForm.asset_code, tlForm.asset_issuer)}
                >
                  {tlLoading ? 'Adding...' : 'Add Trustline'}
                </button>
              </div>
            )}

            {customBalances.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: 14 }}>No custom asset trustlines yet. Add one above to hold USDC or other Stellar assets.</p>
            ) : (
              customBalances.map(b => (
                <div key={b.asset_code + '-' + b.asset_issuer} style={s.assetRow}>
                  <div>
                    <div style={s.assetCode}>{b.asset_code}</div>
                    <div style={s.assetIssuer}>{b.asset_issuer ? b.asset_issuer.slice(0, 12) + '...' + b.asset_issuer.slice(-6) : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={s.assetBal}>{b.balance.toFixed(2)}</div>
                    <button
                      style={s.btnDanger}
                      disabled={removingAsset === b.asset_code}
                      onClick={() => handleRemoveTrustline(b.asset_code, b.asset_issuer)}
                      title="Remove trustline (requires zero balance)"
                    >
                      {removingAsset === b.asset_code ? '...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={s.card}>
            <h3 style={{ marginBottom: 4, color: '#333' }}>Withdraw XLM</h3>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Transfer XLM from your platform wallet to any Stellar public key.</p>
            <form onSubmit={handleSend} noValidate>
              <label style={s.label}>Destination Address</label>
              <input
                style={s.input} type="text" placeholder="G... or name*domain" spellCheck={false}
                value={sendForm.destination}
                onChange={e => setSendForm(f => ({ ...f, destination: e.target.value }))}
              />
              <label style={s.label}>Amount (XLM)</label>
              <input
                style={s.input} type="number" min="0.0000001" step="any" placeholder="0.00"
                value={sendForm.amount}
                onChange={e => setSendForm(f => ({ ...f, amount: e.target.value }))}
              />
              <label style={s.label}>Memo <span style={{ color: '#aaa', fontWeight: 400 }}>(optional, max 28 chars)</span></label>
              <input
                style={s.input} type="text" maxLength={28} placeholder="e.g. payment for order #42"
                value={sendForm.memo}
                onChange={e => setSendForm(f => ({ ...f, memo: e.target.value }))}
              />
              <button type="submit" style={s.btn} disabled={sending}>
                {sending ? 'Withdrawing...' : 'Withdraw XLM'}
              </button>
            </form>
            {sendMsg && (
              <div style={{ ...s.msg, background: sendMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: sendMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
                {sendMsg.text}
                {sendMsg.txHash && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    TX: <a href={'https://stellar.expert/explorer/testnet/tx/' + sendMsg.txHash} target="_blank" rel="noreferrer" style={{ color: '#2d6a4f', wordBreak: 'break-all' }}>{sendMsg.txHash}</a>
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
                {wallet?.referralCode || '-'}
              </div>
            </div>
          </div>

          <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333', display: 'flex', alignItems: 'center', gap: 8 }}>
          🔔 Activity Alerts
          {unreadCount > 0 && (
            <span style={{ background: '#c0392b', color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
              {unreadCount}
            </span>
          )}
        </h3>
        {alerts.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>No alerts yet.</p>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} style={{ borderBottom: '1px solid #eee', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', opacity: alert.read_at ? 0.6 : 1 }}>
              <div>
                <div style={{ fontSize: 14, color: alert.type === 'large_payment' ? '#c0392b' : '#856404', fontWeight: alert.read_at ? 400 : 600 }}>
                  {alert.type === 'large_payment' ? '⚠️ Large Payment' : '❌ Failed Transactions'}
                </div>
                <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{alert.message}</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{new Date(alert.created_at).toLocaleString()}</div>
              </div>
              {!alert.read_at && (
                <button
                  style={{ background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: '#555', flexShrink: 0, marginLeft: 8 }}
                  onClick={async () => {
                    await api.markAlertRead(alert.id).catch(() => {});
                    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, read_at: new Date().toISOString() } : a));
                    setUnreadCount(prev => Math.max(0, prev - 1));
                  }}
                >
                  Mark read
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>Transaction History</h3>
        {txs.length === 0 && <p style={{ color: '#888', fontSize: 14 }}>No transactions yet. Fund your wallet and make a purchase.</p>}
        {txs.map((tx) => {
          const counterpartyKey = tx.type === 'sent' ? tx.to : tx.from;
          const counterpartyFed = tx.type === 'sent' ? tx.to_federation : tx.from_federation;
          return (
            <div key={tx.id} style={s.tx}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={tx.type === 'sent' ? s.sent : s.recv}>
                  {tx.type === 'sent' ? '↑ Sent' : '↓ Received'} {parseFloat(tx.amount).toFixed(2)} XLM
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{new Date(tx.created_at).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                  {tx.type === 'sent' ? 'To: ' : 'From: '}
                  {counterpartyFed && (
                    <span style={{ fontWeight: 600, marginRight: 4 }}>{counterpartyFed}</span>
                  )}
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#aaa', wordBreak: 'break-all' }}>
                    {counterpartyKey}
                  </span>
                  <button
                    title="Copy public key"
                    onClick={() => navigator.clipboard.writeText(counterpartyKey)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', color: '#888', verticalAlign: 'middle' }}
                  >⧉</button>
                </div>
                <div style={s.hash}>{tx.transaction_hash}</div>
              </div>
              <a href={`https://stellar.expert/explorer/testnet/tx/${tx.transaction_hash}`}
                target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: '#2d6a4f', flexShrink: 0, marginLeft: 12 }}>View ↗</a>
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}