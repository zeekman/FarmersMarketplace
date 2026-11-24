import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import './orderTimeline.css';
import { useNetwork } from '../../context/NetworkContext';

const SETTLEMENT_LABEL = { refund: 'Refund', release: 'Release', claim: 'Claim' };
export const settlementLabel = (type) => SETTLEMENT_LABEL[type] || 'Settlement';

/** Truncated tx hash linking to the network-correct explorer, with a copy button. */
export function TxHashLink({ label, hash }) {
  const { explorerUrl } = useNetwork();
  if (!hash) return null;
  const short = `${hash.slice(0, 4)}…${hash.slice(-4)}`;
  return (
    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
      {label}:{' '}
      <a
        href={explorerUrl('tx', hash)}
        target="_blank"
        rel="noreferrer"
        title={hash}
        aria-label={`${label} transaction ${hash}`}
        style={{ color: '#2d6a4f', fontFamily: 'monospace' }}
      >
        {short}
      </a>{' '}
      <button
        type="button"
        aria-label={`Copy ${label} transaction hash`}
        onClick={() => navigator.clipboard?.writeText(hash).catch(() => {})}
        style={{ fontSize: 11, padding: '1px 6px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
      >
        Copy
      </button>
    </div>
  );
}

/** Fulfilment path shown as a stepper (#1501). Off-path terminal states render after it. */
export const FULFILMENT_STEPS = ['pending', 'confirming', 'paid', 'shipped', 'delivered'];
const OFF_PATH = ['failed', 'disputed', 'refunded', 'returned'];

const ESCROW_LABEL = {
  held: 'Escrow: funds held',
  active: 'Escrow: funds held',
  released: 'Escrow: released to farmer',
  refunded: 'Escrow: refunded to you',
  disputed: 'Escrow: frozen (disputed)',
};

const FAILURE_REASON = {
  payment_failed: 'The payment could not be completed.',
  coupon_exhausted: 'The coupon reached its usage limit.',
  reward_redemption_failed: 'Reward tokens could not be redeemed.',
  payment_link_creation_failed: 'The payment link could not be created.',
  insufficient_balance: 'Your wallet balance was too low.',
  unfunded_account: 'Your wallet was not funded.',
};

export function describeFailure(reason) {
  if (!reason) return 'The order could not be completed.';
  return FAILURE_REASON[reason] || reason.replace(/_/g, ' ');
}

function formatTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Maps each status to the first time the order entered it. */
export function stepTimestamps(history = [], createdAt) {
  const times = { pending: createdAt || null };
  for (const h of history || []) {
    if (h?.to_status && !times[h.to_status]) times[h.to_status] = h.created_at;
  }
  return times;
}

/**
 * Horizontal (vertical on narrow screens) stepper with timestamps from
 * `order_status_history`, plus a separate escrow line and failure reason.
 */
export default function OrderStatusTimeline({ order, onRetry, retrying = false }) {
  const [details, setDetails] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(api.getOrderHistory?.(order.id))
      .then((res) => { if (!cancelled) setDetails(res?.data ?? null); })
      .catch(() => { if (!cancelled) setDetails(null); });
    return () => { cancelled = true; };
  }, [order.id, order.status]);

  const status = order.status;
  const times = stepTimestamps(details?.history, order.created_at);
  // `processing` is an optional sub-step of `paid`.
  const pathStatus = status === 'processing' ? 'paid' : status;
  const offPath = OFF_PATH.includes(status);
  let currentIdx = FULFILMENT_STEPS.indexOf(pathStatus);
  if (currentIdx === -1) {
    // Off-path: show progress up to the last fulfilment step the order actually reached.
    currentIdx = FULFILMENT_STEPS.reduce((acc, step, i) => (times[step] ? i : acc), 0);
  }
  const escrow = details?.escrow;
  const failureReason = details?.failure_reason ?? order.failure_reason;

  return (
    <div className="order-timeline" data-testid={`order-timeline-${order.id}`}>
      <ol className="order-timeline__steps" aria-label={`Order #${order.id} progress`}>
        {FULFILMENT_STEPS.map((step, i) => {
          const done = i <= currentIdx;
          const current = !offPath && i === currentIdx;
          const time = formatTime(times[step]);
          return (
            <li
              key={step}
              className={`order-timeline__step${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
              aria-current={current ? 'step' : undefined}
            >
              <span className="order-timeline__dot" aria-hidden="true" />
              <span className="order-timeline__label">{step}</span>
              {time && <time className="order-timeline__time" dateTime={times[step]}>{time}</time>}
              <span className="sr-only">{current ? ' (current)' : done ? ' (completed)' : ' (not reached)'}</span>
            </li>
          );
        })}
        {offPath && (
          <li className={`order-timeline__step is-current is-${status}`} aria-current="step">
            <span className="order-timeline__dot" aria-hidden="true" />
            <span className="order-timeline__label">{status}</span>
            {formatTime(times[status]) && (
              <time className="order-timeline__time" dateTime={times[status]}>{formatTime(times[status])}</time>
            )}
          </li>
        )}
      </ol>

      {order.settled_at && (
        <div className="order-timeline__settlement" data-testid={`order-settlement-${order.id}`}>
          ✅ Settled {formatTime(order.settled_at)} · {settlementLabel(order.settlement_type)}
        </div>
      )}

      {status === 'confirming' && (
        <div className="order-timeline__note" role="status">Confirming payment on the Stellar network…</div>
      )}

      {escrow && (
        <div className="order-timeline__escrow" data-testid={`order-escrow-${order.id}`}>
          🔒 {ESCROW_LABEL[escrow.state] || `Escrow: ${escrow.state}`}
          {escrow.auto_release_at && ['held', 'active'].includes(escrow.state) && (
            <> · auto-release {new Date(escrow.auto_release_at).toLocaleDateString()}</>
          )}
        </div>
      )}

      {status === 'failed' && (
        <div className="order-timeline__failed" role="alert">
          <span>❌ Order failed: {describeFailure(failureReason)}</span>
          {onRetry && (
            <button type="button" className="order-timeline__retry" onClick={() => onRetry(order)} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
