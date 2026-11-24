import React from 'react';

// Same shimmer tokens as SkeletonProductCard. Classes (not inline styles) so the
// reduced-motion media query can switch the animation off.
if (typeof document !== 'undefined' && !document.getElementById('skeleton-loaders-style')) {
  const style = document.createElement('style');
  style.id = 'skeleton-loaders-style';
  style.textContent = `
    @keyframes shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position:  400px 0; }
    }
    .skeleton-block {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 800px 100%;
      animation: shimmer 1.4s infinite linear;
      border-radius: 6px;
    }
    @media (prefers-reduced-motion: reduce) {
      .skeleton-block { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

// Mirrors the row layout in pages/Orders.jsx (s.row + s.right).
export function SkeletonOrderRow() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 12,
        padding: '16px 20px',
        borderBottom: '1px solid #f0f0f0',
        alignItems: 'start',
      }}
    >
      <div>
        <div className="skeleton-block" style={{ width: 180, height: 18, marginBottom: 4 }} />
        <div className="skeleton-block" style={{ width: 120, height: 16, marginBottom: 2 }} />
        <div className="skeleton-block" style={{ width: 150, height: 16 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div className="skeleton-block" style={{ width: 84, height: 24, borderRadius: 20 }} />
        <div className="skeleton-block" style={{ width: 70, height: 20 }} />
      </div>
    </div>
  );
}

// Mirrors WalletBalanceCard inside its card (padding and margin from walletStyles s.card).
export function SkeletonBalanceCard() {
  return (
    <div
      aria-hidden="true"
      style={{
        background: 'var(--color-surface)',
        borderRadius: 12,
        padding: 'clamp(16px, 4vw, 24px)',
        boxShadow: '0 1px 8px var(--color-shadow)',
        marginBottom: 24,
      }}
    >
      <div className="skeleton-block" style={{ width: 90, height: 16, marginBottom: 8 }} />
      <div className="skeleton-block" style={{ width: 200, height: 48 }} />
      <div className="skeleton-block" style={{ width: 240, height: 16, marginTop: 8 }} />
      <div className="skeleton-block" style={{ width: '90%', height: 14, marginTop: 8 }} />
      <div className="skeleton-block" style={{ width: 200, height: 40, marginTop: 16, borderRadius: 8 }} />
    </div>
  );
}

// Mirrors one row of TransactionHistory (walletStyles s.tx).
export function SkeletonTxRow() {
  return (
    <div
      aria-hidden="true"
      style={{
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="skeleton-block" style={{ width: 150, height: 18, marginBottom: 6 }} />
        <div className="skeleton-block" style={{ width: 110, height: 14, marginBottom: 6 }} />
        <div className="skeleton-block" style={{ width: '70%', height: 14 }} />
      </div>
      <div className="skeleton-block" style={{ width: 48, height: 14, marginLeft: 12, flexShrink: 0 }} />
    </div>
  );
}
