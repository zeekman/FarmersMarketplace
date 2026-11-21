import React from 'react';

/**
 * PendingMultisigPanel — shows cooperative multi-sig transactions awaiting
 * signatures (FE-30).
 * Extracted from Dashboard.jsx (#1060).
 *
 * Props:
 *   pendingTxs  – array of pending tx objects (coopName, amount, destination, order_id?,
 *                 signatures, threshold, members[{id,name,signed}], payload_hex, alreadySigned, expires_at,
 *                 member_hash?, current_member_hash?)
 *   signingTxId – id of the tx currently being signed/submitted (or null)
 *   onSign      – (txId: number) => void            sign with the custodial key
 *   onSignWithFreighter – (tx) => void              sign payload_hex with Freighter
 *   onSubmit    – (txId: number) => void            submit once threshold is met
 */

const CONTRACT_ERRORS = {
  NotEnoughSignatures: 'Not enough member signatures yet — wait for more members to sign.',
  CoopNotConfigured: 'This cooperative has no multisig configuration. Ask an admin to set up signers.',
  InvalidCoopConfig: 'The cooperative signer configuration is invalid (check threshold and member count).',
};

export function multisigErrorMessage(e) {
  const raw = [e?.code, e?.error, e?.message, typeof e === 'string' ? e : ''].filter(Boolean).join(' ');
  const key = Object.keys(CONTRACT_ERRORS).find((k) => raw.includes(k));
  return key ? CONTRACT_ERRORS[key] : e?.message || String(e || 'Something went wrong');
}

/**
 * A pending release is stale when the member list changed after signatures were
 * collected (contract emits `coop_changed` with a member hash). Signatures are
 * matched by position, so a reorder invalidates everything collected so far.
 */
export function isStaleMemberHash(tx) {
  if (!tx) return false;
  const stored = tx.member_hash ?? tx.memberHash;
  const current = tx.current_member_hash ?? tx.currentMemberHash;
  if (stored == null || current == null) return false;
  return String(stored) !== String(current);
}

export default function PendingMultisigPanel({
  pendingTxs = [],
  signingTxId = null,
  onSign,
  onSignWithFreighter,
  onSubmit,
}) {
  if (pendingTxs.length === 0) return null;

  const s = {
    card: {
      borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001',
      border: '1px solid #f9a825', background: '#fffde7', marginTop: 24,
    },
    btn: {
      background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8,
      cursor: 'pointer', fontWeight: 600, minHeight: 44, fontSize: 13, padding: '6px 14px',
    },
    warn: {
      marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 12,
      background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a',
    },
  };

  return (
    <div style={s.card}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e65100', marginBottom: 12 }}>
        🔏 Pending Signature Requests ({pendingTxs.length})
      </div>
      {pendingTxs.map((tx) => {
        const collected = tx.signatures?.length ?? 0;
        const needed = tx.threshold ?? null;
        const thresholdMet = needed != null && collected >= needed;
        const busy = signingTxId === tx.id;
        const stale = isStaleMemberHash(tx);
        const progressText = needed != null
          ? `${collected} of ${needed} signatures`
          : `${collected} signature(s)`;
        return (
          <div
            key={tx.id}
            data-testid={`multisig-tx-${tx.id}`}
            style={{ borderBottom: '1px solid #ffe082', padding: '10px 0' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {tx.coopName} — {tx.amount} XLM
                  {tx.order_id != null && <span style={{ fontWeight: 400 }}> · Order #{tx.order_id}</span>}
                </div>
                <div style={{ fontSize: 12, color: '#555' }}>
                  To: {tx.destination?.slice(0, 12)}… ·{' '}
                  <strong data-testid={`multisig-progress-${tx.id}`}>{progressText}</strong>
                  {needed != null && (
                    <span> · Threshold: {needed}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#777' }}>
                  Expires: {new Date(tx.expires_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {!tx.alreadySigned && !thresholdMet && !stale && (
                  <>
                    <button
                      type="button"
                      style={{ ...s.btn, background: busy ? '#888' : '#2d6a4f' }}
                      disabled={busy}
                      onClick={() => onSign?.(tx.id)}
                    >
                      {busy ? 'Signing…' : '✍️ Sign'}
                    </button>
                    {onSignWithFreighter && tx.payload_hex && (
                      <button
                        type="button"
                        style={{ ...s.btn, background: busy ? '#888' : '#3949ab' }}
                        disabled={busy}
                        title="Sign the release payload with your Freighter wallet (signBlob)"
                        onClick={() => onSignWithFreighter(tx)}
                      >
                        Sign with Freighter
                      </button>
                    )}
                  </>
                )}
                {onSubmit && (
                  <button
                    type="button"
                    style={{ ...s.btn, background: thresholdMet && !busy && !stale ? '#e65100' : '#bbb' }}
                    disabled={!thresholdMet || busy || stale}
                    title={
                      stale
                        ? 'Members changed — signatures must be collected again'
                        : thresholdMet
                          ? 'Submit the release'
                          : 'Waiting for more signatures'
                    }
                    onClick={() => onSubmit(tx.id)}
                  >
                    Submit release
                  </button>
                )}
              </div>
            </div>

            {stale && (
              <div role="alert" data-testid={`multisig-stale-${tx.id}`} style={s.warn}>
                ⚠️ Members changed — signatures must be collected again
              </div>
            )}

            {Array.isArray(tx.members) && tx.members.length > 0 && (
              <ul aria-label="Signers" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tx.members.map((m) => (
                  <li
                    key={m.id}
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 999,
                      background: m.signed ? '#c8e6c9' : '#eee', color: m.signed ? '#1b5e20' : '#555',
                    }}
                  >
                    {m.signed ? '✓' : '○'} {m.name || `Member ${m.id}`}
                    <span className="sr-only">{m.signed ? ' (signed)' : ' (not signed)'}</span>
                  </li>
                ))}
              </ul>
            )}

            {tx.payload_hex && (
              <details style={{ marginTop: 6, fontSize: 11 }}>
                <summary>Signing payload (hex)</summary>
                <p style={{ margin: '4px 0', color: '#555' }}>
                  Signing this payload authorizes releasing {tx.amount} XLM from {tx.coopName} to{' '}
                  {tx.destination}. Signatures are matched to members by position.
                </p>
                <code style={{ wordBreak: 'break-all', display: 'block', background: '#fff', padding: 6, borderRadius: 4 }}>
                  {tx.payload_hex}
                </code>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
