import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';

// Stellar base fee: 100 stroops per operation; a checkout is a single operation.
export const NETWORK_FEE_XLM = 0.00001;
// Minimum balance a Stellar account must keep (2 × 0.5 XLM base reserve),
// plus 0.5 XLM per subentry (trustline, offer, …).
export const BASE_RESERVE_XLM = 1;
export const SUBENTRY_RESERVE_XLM = 0.5;

const xlm = (n) => `${Number(n).toFixed(7).replace(/0+$/, '').replace(/\.$/, '')} XLM`;

/**
 * "Review your order" step shown before Buy Now submits a real Stellar transaction
 * (FE-16). Nothing is placed until the buyer clicks Confirm & Pay; the parent passes
 * `submitting` so the confirm button stays disabled across double-clicks.
 *
 * Props:
 *   lines      – { unitPrice, tierPrice, quantity, unit, subtotal, couponDiscount,
 *                  couponCode, bundleDiscount, shipping, total }
 *   escrow     – boolean, order is held in escrow
 *   payingWith – optional label (e.g. "Freighter GABC…") for the paying account
 *   blockedReason – non-empty disables Confirm & Pay with that explanation
 *   submitting, onConfirm, onCancel
 */
export default function CheckoutReviewModal({ lines, escrow, payingWith, blockedReason, submitting, onConfirm, onCancel }) {
  const titleId = useId();
  const dialogRef = useModalA11y(true, onCancel);
  const [rate, setRate] = useState(null); // { usd, fetchedAt }
  const [balance, setBalance] = useState(null); // { balance, subentries }
  const [autoReleaseDays, setAutoReleaseDays] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getXlmRate()
      .then((r) => !cancelled && r?.rate && setRate({ usd: Number(r.rate), fetchedAt: r.fetchedAt || r.timestamp || new Date().toISOString() }))
      .catch(() => {});
    api.getWallet()
      .then((w) => !cancelled && setBalance({ balance: Number(w.balance ?? w.data?.balance ?? 0), subentries: Number(w.subentry_count ?? w.data?.subentry_count ?? 0) }))
      .catch(() => {});
    if (escrow) {
      api.getFeePreview(lines.total)
        .then((r) => !cancelled && setAutoReleaseDays(r.auto_release_days ?? null))
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [escrow, lines.total]);

  const grandTotal = Number(lines.total) + Number(lines.shipping || 0) + NETWORK_FEE_XLM;
  const minReserve = balance ? BASE_RESERVE_XLM + balance.subentries * SUBENTRY_RESERVE_XLM : null;
  const remaining = balance ? balance.balance - grandTotal : null;
  const belowReserve = balance && !payingWith && remaining < minReserve;
  const autoReleaseDate = autoReleaseDays != null ? new Date(Date.now() + autoReleaseDays * 86_400_000) : null;
  const disabled = submitting || Boolean(blockedReason);

  const row = (label, value, opts = {}) => (
    <tr key={label}>
      <td style={{ padding: '4px 0', color: opts.muted ? '#888' : '#444' }}>{label}</td>
      <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace', color: opts.color, fontWeight: opts.bold ? 700 : 400 }}>{value}</td>
    </tr>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onCancel?.()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="checkout-review"
        style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}>
        <h2 id={titleId} style={{ fontSize: 17, margin: '0 0 12px', color: '#222' }}>Review your order</h2>

        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }} aria-label="Price breakdown">
          <tbody>
            {row('Unit price', `${xlm(lines.unitPrice)} / ${lines.unit || 'unit'}`)}
            {lines.tierPrice != null && lines.tierPrice !== lines.unitPrice && row('Quantity tier price', `${xlm(lines.tierPrice)} / ${lines.unit || 'unit'}`)}
            {row('Quantity', String(lines.quantity))}
            {row('Subtotal', xlm(lines.subtotal))}
            {lines.couponDiscount > 0 && row(`Coupon ${lines.couponCode || ''}`.trim(), `−${xlm(lines.couponDiscount)}`, { color: '#2d6a4f' })}
            {lines.bundleDiscount > 0
              ? row('Bundle discount', `−${xlm(lines.bundleDiscount)}`, { color: '#2d6a4f' })
              : row('Bundle discount', 'applied at payment if eligible', { muted: true })}
            {row('Shipping', lines.shipping > 0 ? xlm(lines.shipping) : 'Free')}
            {row('Stellar network fee', xlm(NETWORK_FEE_XLM))}
            <tr><td colSpan={2} style={{ borderTop: '1px solid #eee', paddingTop: 4 }} /></tr>
            {row('Total', xlm(grandTotal), { bold: true })}
            {rate && row('≈ USD', `$${(grandTotal * rate.usd).toFixed(2)}`, { muted: true })}
          </tbody>
        </table>
        {rate && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>
            Rate 1 XLM = ${rate.usd.toFixed(4)} as of {new Date(rate.fetchedAt).toLocaleString()}
          </div>
        )}

        {payingWith && <div style={{ fontSize: 13, color: '#444', marginTop: 12 }}>Paying with {payingWith}</div>}

        {balance && !payingWith && (
          <div style={{ fontSize: 13, color: '#444', marginTop: 12 }}>
            Balance after purchase: <strong>{xlm(Math.max(remaining, 0))}</strong>
          </div>
        )}
        {belowReserve && (
          <div role="alert" style={{ background: '#fff3cd', color: '#7a5800', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginTop: 8 }}>
            This would leave less than the {xlm(minReserve)} minimum reserve your Stellar account must hold,
            so the payment will likely fail.
          </div>
        )}

        {escrow && (
          <p style={{ fontSize: 13, color: '#444', margin: '12px 0 0' }}>
            🔒 Your payment is held in escrow and only released to the farmer when you confirm delivery
            {autoReleaseDate ? `, or automatically on ${autoReleaseDate.toLocaleDateString()} (${autoReleaseDays} days)` : ''}.
          </p>
        )}

        {blockedReason && <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 12 }}>{blockedReason}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" onClick={onCancel} disabled={submitting}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#f0f0f0', color: '#333', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={disabled} aria-busy={submitting}
            data-testid="confirm-pay-btn"
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: disabled ? '#ccc' : '#2d6a4f', color: '#fff', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }}>
            {submitting ? 'Processing…' : 'Confirm & Pay'}
          </button>
        </div>
      </div>
    </div>
  );
}

