import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getStellarErrorMessage } from '../utils/stellarErrors';

const DISCLAIMER_KEY = 'testnet_disclaimer_dismissed';

const s = {
  page: { maxWidth: 800, margin: '0 auto', padding: 24 },
  disclaimer: {
    background: '#fff8e1',
    border: '1px solid #f9a825',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 20,
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
  },
  disclaimerIcon: { fontSize: 20, flexShrink: 0, marginTop: 1 },
  disclaimerBody: { flex: 1, fontSize: 13, color: '#5d4037', lineHeight: 1.5 },
  disclaimerTitle: { fontWeight: 700, fontSize: 14, marginBottom: 3, color: '#e65100' },
  disclaimerDismiss: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#999',
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
  },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 1px 8px #0001',
    marginBottom: 24,
  },
  balance: { fontSize: 40, fontWeight: 700, color: '#2d6a4f' },
  key: {
    fontSize: 12,
    color: '#888',
    wordBreak: 'break-all',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  btn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    marginTop: 16,
  },
  btnDanger: {
    background: '#c0392b',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  tx: {
    borderBottom: '1px solid #eee',
    padding: '12px 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sent: { color: '#c0392b', fontWeight: 600 },
  recv: { color: '#2d6a4f', fontWeight: 600 },
  hash: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 },
  msg: { padding: '10px 14px', borderRadius: 8, marginTop: 12, fontSize: 14 },
  label: { display: 'block', fontSize: 13, color: '#555', marginBottom: 4, marginTop: 14 },
  input: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  row: { display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 16 },
};

export default function Wallet() {
  const { user } = useAuth();
  const [disclaimerVisible, setDisclaimerVisible] = useState(
    () => !sessionStorage.getItem(DISCLAIMER_KEY)
  );
  const [wallet, setWallet] = useState(null);
  const [txs, setTxs] = useState([]);
  const [funding, setFunding] = useState(false);
  const [fundMsg, setFundMsg] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Send form state
  const [sendForm, setSendForm] = useState({
    destination: '',
    amount: '',
    currency: 'XLM',
    memo: '',
  });
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState(null);

  function dismissDisclaimer() {
    sessionStorage.setItem(DISCLAIMER_KEY, '1');
    setDisclaimerVisible(false);
  }

  async function load() {
    setLoadError(null);
    try {
      const [w, t] = await Promise.all([api.getWallet(), api.getTransactions()]);
      setWallet(w);
      setTxs(t);
    } catch (err) {
      setLoadError(getStellarErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleFund() {
    setFunding(true);
    setFundMsg(null);
    try {
      const res = await api.fundWallet();
      setFundMsg({ type: 'ok', text: res.message });
      load();
    } catch (err) {
      setFundMsg({ type: 'err', text: getStellarErrorMessage(err) });
    } finally {
      setFunding(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    setSendMsg(null);

    const amount = parseFloat(sendForm.amount);
    if (!sendForm.destination.trim())
      return setSendMsg({ type: 'err', text: 'Destination address is required.' });
    if (!/^G[A-Z2-7]{55}$/.test(sendForm.destination.trim()))
      return setSendMsg({ type: 'err', text: 'Invalid Stellar public key.' });
    if (sendForm.currency !== 'XLM')
      return setSendMsg({
        type: 'err',
        text: `"${sendForm.currency}" is not supported. This platform only supports XLM (Stellar Lumens). Other tokens and assets cannot be sent here.`,
      });
    if (!amount || amount <= 0)
      return setSendMsg({ type: 'err', text: 'Amount must be greater than 0.' });
    if (sendForm.memo.length > 28)
      return setSendMsg({ type: 'err', text: 'Memo must be 28 characters or fewer.' });

    setSending(true);
    try {
      const res = await api.sendXLM({
        destination: sendForm.destination.trim(),
        amount,
        memo: sendForm.memo.trim() || undefined,
      });
      setSendMsg({ type: 'ok', text: `Sent ${res.amount} XLM`, txHash: res.txHash });
      setSendForm({ destination: '', amount: '', currency: 'XLM', memo: '' });
      load();
    } catch (err) {
      setSendMsg({ type: 'err', text: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.title}>💳 My Wallet</div>

      {disclaimerVisible && (
        <div style={s.disclaimer} role="alert" aria-label="Testnet disclaimer">
          <span style={s.disclaimerIcon}>⚠️</span>
          <div style={s.disclaimerBody}>
            <div style={s.disclaimerTitle}>Testnet Only — No Real Money</div>
            This wallet uses <strong>Stellar Testnet XLM</strong>, which has{' '}
            <strong>no monetary value</strong> and cannot be exchanged or withdrawn. It exists
            solely for testing purposes. Never send real assets to a testnet address.
          </div>
          <button
            style={s.disclaimerDismiss}
            onClick={dismissDisclaimer}
            aria-label="Dismiss disclaimer"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {loadError && (
        <div style={{ ...s.msg, background: '#fee', color: '#c0392b', marginBottom: 16 }}>
          ⚠️ {loadError}
        </div>
      )}

      <div style={s.card}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>XLM Balance</div>
        <div style={s.balance}>{wallet ? wallet.balance.toFixed(2) : '—'} XLM</div>
        <div style={s.key}>Public Key: {wallet?.publicKey}</div>
        <div
          style={{
            fontSize: 12,
            color: '#888',
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              background: '#fff3cd',
              color: '#856404',
              border: '1px solid #ffc107',
              borderRadius: 4,
              padding: '1px 7px',
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            TESTNET
          </span>
          XLM shown here has no real-world value.
        </div>

        <button style={s.btn} onClick={handleFund} disabled={funding}>
          {funding ? 'Funding...' : '🚰 Fund with Testnet XLM'}
        </button>
        {fundMsg && (
          <div
            style={{
              ...s.msg,
              background: fundMsg.type === 'ok' ? '#d8f3dc' : '#fee',
              color: fundMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
            }}
          >
            {fundMsg.text}
          </div>
        )}
      </div>

      {/* Referral Program Card */}
      <div style={s.card}>
        <h3 style={{ marginBottom: 4, color: '#333' }}>🎁 Referral Program</h3>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          Earn 1 XLM for every friend who joins and places their first order.
        </p>

        <div
          style={{
            background: '#f8f9fa',
            padding: 16,
            borderRadius: 8,
            border: '1px dashed #ced4da',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: '#6c757d',
              marginBottom: 4,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Your Referral Code
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: '#2d6a4f',
                fontFamily: 'monospace',
                letterSpacing: 1,
              }}
            >
              {wallet?.referralCode || '—'}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(wallet?.referralCode);
                alert('Code copied!');
              }}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #2d6a4f',
                background: 'none',
                color: '#2d6a4f',
                cursor: 'pointer',
              }}
            >
              Copy Code
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => {
                const link = `${window.location.origin}/register?ref=${wallet?.referralCode}`;
                navigator.clipboard.writeText(link);
                alert('Referral link copied!');
              }}
              style={{ ...s.btn, marginTop: 0, width: '100%' }}
            >
              🔗 Copy Referral Link
            </button>
          </div>
        </div>
      </div>

      {/* Send XLM card */}
      <div style={s.card}>
        <h3 style={{ marginBottom: 4, color: '#333' }}>↑ Send XLM</h3>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
          Transfer XLM to any external Stellar address.
        </p>

        <form onSubmit={handleSend} noValidate>
          <label style={s.label}>Destination Address</label>
          <input
            style={s.input}
            type="text"
            placeholder="G..."
            value={sendForm.destination}
            onChange={(e) => setSendForm((f) => ({ ...f, destination: e.target.value }))}
            spellCheck={false}
          />

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Amount</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  type="number"
                  min="0.0000001"
                  step="any"
                  placeholder="0.00"
                  value={sendForm.amount}
                  onChange={(e) => setSendForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <select
                  style={{
                    padding: '9px 10px',
                    border: '1px solid #ddd',
                    borderRadius: 8,
                    fontSize: 14,
                    background: '#f9f9f9',
                    cursor: 'pointer',
                    minWidth: 90,
                  }}
                  value={sendForm.currency}
                  onChange={(e) => setSendForm((f) => ({ ...f, currency: e.target.value }))}
                  aria-label="Currency"
                >
                  <option value="XLM">XLM ✓</option>
                  <option value="USDC">USDC</option>
                  <option value="BTC">BTC</option>
                  <option value="ETH">ETH</option>
                  <option value="other">Other…</option>
                </select>
              </div>
              {sendForm.currency !== 'XLM' && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: '#c0392b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  ⛔ Only <strong>XLM</strong> is supported. Select XLM to continue.
                </div>
              )}
              {sendForm.currency === 'XLM' && (
                <div style={{ marginTop: 5, fontSize: 11, color: '#888' }}>
                  Only XLM (Stellar Lumens) is accepted on this platform.
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>
                Memo{' '}
                <span style={{ color: '#aaa', fontWeight: 400 }}>(optional, max 28 chars)</span>
              </label>
              <input
                style={s.input}
                type="text"
                maxLength={28}
                placeholder="e.g. payment for invoice #42"
                value={sendForm.memo}
                onChange={(e) => setSendForm((f) => ({ ...f, memo: e.target.value }))}
              />
            </div>
          </div>

          <button type="submit" style={{ ...s.btn, marginTop: 16 }} disabled={sending}>
            {sending ? 'Sending...' : '🚀 Send XLM'}
          </button>
        </form>

        {sendMsg && (
          <div
            style={{
              ...s.msg,
              background: sendMsg.type === 'ok' ? '#d8f3dc' : '#fee',
              color: sendMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
            }}
          >
            {sendMsg.text}
            {sendMsg.txHash && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                TX:{' '}
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${sendMsg.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#2d6a4f', wordBreak: 'break-all' }}
                >
                  {sendMsg.txHash}
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>Transaction History</h3>
        {txs.length === 0 && (
          <p style={{ color: '#888', fontSize: 14 }}>
            No transactions yet. Fund your wallet and make a purchase.
          </p>
        )}
        {txs.map((tx) => (
          <div key={tx.id} style={s.tx}>
            <div>
              <div style={tx.type === 'sent' ? s.sent : s.recv}>
                {tx.type === 'sent' ? '↑ Sent' : '↓ Received'} {parseFloat(tx.amount).toFixed(2)}{' '}
                XLM
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {new Date(tx.created_at).toLocaleString()}
              </div>
              <div style={s.hash}>{tx.transaction_hash}</div>
            </div>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${tx.transaction_hash}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: '#2d6a4f' }}
            >
              View ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
