import React, { useEffect, useRef, useState } from 'react';
import { getRemaining } from '../FlashSaleCountdown';

// Refund-window messages are announced only when one of these is crossed, never per tick (#1502).
const REFUND_THRESHOLDS = [
  { seconds: 86400, message: 'Refunds open in 1 day' },
  { seconds: 3600, message: 'Refunds open in 1 hour' },
];

/** "2d 4h", "5d", "3h 10m", "45m". Minute resolution matches the once-a-minute tick. */
export function formatSpan(totalSeconds) {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.max(1, Math.floor((totalSeconds % 3600) / 60));
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Soroban escrow timing for a buyer. Unix-second fields come straight from the
 * order API (pg BIGINT may arrive as a string, so they are coerced here).
 */
export default function EscrowCountdown({ timeoutUnix, autoReleaseUnix, releaseAfterUnix, onRefund, refunding = false }) {
  const [, setTick] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const prevSecondsRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const refund = getRemaining(new Date(Number(timeoutUnix) * 1000));
  const refundOpen = refund.diff <= 0;
  const refundOpensAt = new Date(Number(timeoutUnix) * 1000).toLocaleString();

  useEffect(() => {
    const prev = prevSecondsRef.current;
    prevSecondsRef.current = refund.totalSeconds;
    if (prev === null) return;
    const crossed = REFUND_THRESHOLDS.filter((t) => prev > t.seconds && refund.totalSeconds <= t.seconds);
    if (prev > 0 && refund.totalSeconds <= 0) setAnnouncement('Refund is now available');
    else if (crossed.length) setAnnouncement(crossed[crossed.length - 1].message);
  }, [refund.totalSeconds]);

  const autoRelease = autoReleaseUnix ? getRemaining(new Date(Number(autoReleaseUnix) * 1000)) : null;
  const releaseAfter = releaseAfterUnix ? getRemaining(new Date(Number(releaseAfterUnix) * 1000)) : null;

  return (
    <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
      <div>{refundOpen ? 'Refund available now' : `Refund available in ${formatSpan(refund.totalSeconds)}`}</div>
      {autoRelease && (
        <div>
          {autoRelease.diff > 0
            ? `Auto-releases to farmer in ${formatSpan(autoRelease.totalSeconds)}`
            : 'Auto-release is open to anyone now'}
        </div>
      )}
      {releaseAfter && releaseAfter.diff > 0 && (
        <div>Releasable after {new Date(Number(releaseAfterUnix) * 1000).toLocaleString()}</div>
      )}
      <button
        type="button"
        onClick={onRefund}
        disabled={!refundOpen || refunding}
        title={refundOpen ? undefined : `Refunds open at the escrow timeout: ${refundOpensAt}`}
        style={{
          marginTop: 6,
          fontSize: 12,
          padding: '5px 14px',
          borderRadius: 8,
          border: '1px solid #c0392b',
          cursor: !refundOpen || refunding ? 'not-allowed' : 'pointer',
          background: '#fff',
          color: '#c0392b',
          fontWeight: 600,
          opacity: refundOpen ? 1 : 0.5,
        }}
      >
        {refunding ? 'Refunding...' : '↩️ Refund'}
      </button>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
