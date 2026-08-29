import React from 'react';

/**
 * PendingMultisigPanel — shows cooperative multi-sig transactions awaiting
 * the farmer's signature.
 * Extracted from Dashboard.jsx (#1060).
 *
 * Props:
 *   pendingTxs  – array of pending tx objects (with coopName, amount, destination, signatures, expires_at)
 *   signingTxId – id of the tx currently being signed (or null)
 *   onSign      – (txId: number) => void
 */
export default function PendingMultisigPanel({ pendingTxs = [], signingTxId = null, onSign }) {
  if (pendingTxs.length === 0) return null;

  const s = {
    card: {
      background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001',
      border: '1px solid #f9a825', background: '#fffde7', marginTop: 24,
    },
    btn: {
      background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8,
      padding: '10px 20px', cursor: 'pointer', fontWeight: 600, minHeight: 44,
    },
  };

  return (
    <div style={s.card}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e65100', marginBottom: 12 }}>
        🔏 Pending Signature Requests ({pendingTxs.length})
      </div>
      {pendingTxs.map((tx) => (
        <div
          key={tx.id}
          style={{
            borderBottom: '1px solid #ffe082',
            padding: '10px 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {tx.coopName} — {tx.amount} XLM
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>
              To: {tx.destination?.slice(0, 12)}… · {tx.signatures.length} signature(s) collected
            </div>
            <div style={{ fontSize: 11, color: '#aaa' }}>
              Expires: {new Date(tx.expires_at).toLocaleString()}
            </div>
          </div>
          <button
            style={{
              ...s.btn,
              fontSize: 13,
              padding: '6px 14px',
              background: signingTxId === tx.id ? '#888' : '#2d6a4f',
            }}
            disabled={signingTxId === tx.id}
            onClick={() => onSign?.(tx.id)}
          >
            {signingTxId === tx.id ? 'Signing…' : '✍️ Sign'}
          </button>
        </div>
      ))}
    </div>
  );
}
