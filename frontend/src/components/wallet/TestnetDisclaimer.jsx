import React, { useState } from 'react';
import { safeStorage } from '../../utils/safeStorage';
import { useNetwork } from '../../context/NetworkContext';

const DISCLAIMER_KEY = 'testnet_disclaimer_dismissed';

/** One-time modal reminding users that testnet XLM has no value. */
export default function TestnetDisclaimer() {
  const [visible, setVisible] = useState(() => safeStorage.get(DISCLAIMER_KEY) !== 'true');
  const { network } = useNetwork();

  function dismiss() {
    safeStorage.set(DISCLAIMER_KEY, 'true');
    setVisible(false);
  }

  // Only relevant on testnet; never show the disclaimer on mainnet.
  if (network === 'mainnet') return null;
  if (!visible) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="disclaimer-modal-title" style={{ position: 'fixed', inset: 0, background: 'var(--color-dialog-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 32, maxWidth: 420, width: '90%', boxShadow: '0 4px 24px var(--color-shadow-strong)' }}>
        <div id="disclaimer-modal-title" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-warning)', marginBottom: 12 }}>⚠️ Testnet Only</div>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
          This wallet uses <strong>Stellar Testnet XLM</strong>, which has <strong>no monetary value</strong> and cannot be exchanged or withdrawn.
        </p>
        <button onClick={dismiss} style={{ width: '100%', padding: '12px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-on-primary)', cursor: 'pointer', fontWeight: 600, fontSize: 14, minHeight: 44 }}>
          I Understand, Dismiss
        </button>
      </div>
    </div>
  );
}
