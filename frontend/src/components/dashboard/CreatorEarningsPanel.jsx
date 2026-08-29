/**
 * CreatorEarningsPanel
 *
 * Displays accumulated on-chain creator earnings (XLM balance) with a
 * "Claim Earnings" button and feedback message.
 */
import React from 'react';

const s = {
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001' },
  btn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontWeight: 600,
    minHeight: 44,
  },
  msg: { padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
};

/**
 * @param {object}        props
 * @param {object|null}   props.earnings  - Earnings object with `balance` field, or null while loading
 * @param {boolean}       props.claiming  - True while the claim request is in-flight
 * @param {object|null}   props.claimMsg  - Feedback message { type: 'ok'|'err', text: string }
 * @param {function}      props.onClaim   - Called when the user clicks "Claim Earnings"
 */
export default function CreatorEarningsPanel({ earnings, claiming, claimMsg, onClaim }) {
  const balance = earnings ? Number(earnings.balance ?? 0) : 0;
  const canClaim = earnings && balance > 0;

  return (
    <div style={{ ...s.card, marginBottom: 24 }}>
      <h3 style={{ marginBottom: 12, color: '#333' }}>💰 Creator Earnings</h3>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#2d6a4f' }}>
        {earnings ? balance.toFixed(2) : '-'} XLM
      </div>
      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
        Accumulated on-chain earnings available to claim.
      </div>
      <button
        style={{ ...s.btn, marginTop: 14, opacity: !canClaim ? 0.5 : 1 }}
        disabled={claiming || !canClaim}
        onClick={onClaim}
      >
        {claiming ? 'Claiming...' : 'Claim Earnings'}
      </button>
      {claimMsg && (
        <div
          role="status"
          style={{
            ...s.msg,
            marginTop: 12,
            background: claimMsg.type === 'ok' ? '#d8f3dc' : '#fee',
            color: claimMsg.type === 'ok' ? '#2d6a4f' : '#c0392b',
          }}
        >
          {claimMsg.text}
        </div>
      )}
    </div>
  );
}
