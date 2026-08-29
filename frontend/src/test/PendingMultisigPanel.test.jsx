import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import PendingMultisigPanel from '../components/dashboard/PendingMultisigPanel';

const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString();

const PENDING_TXS = [
  {
    id: 10,
    coopName: 'Green Coop',
    amount: 250,
    destination: 'GABC1234567890XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    signatures: ['sig1'],
    expires_at: FUTURE,
  },
  {
    id: 11,
    coopName: 'Harvest Coop',
    amount: 100,
    destination: 'GDEF9876543210XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    signatures: ['sig1', 'sig2'],
    expires_at: FUTURE,
  },
];

// ── Empty state ───────────────────────────────────────────────────────────────

describe('PendingMultisigPanel — empty state', () => {
  it('renders nothing when pendingTxs is empty', () => {
    const { container } = render(<PendingMultisigPanel pendingTxs={[]} onSign={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── Transaction list ──────────────────────────────────────────────────────────

describe('PendingMultisigPanel — transaction list', () => {
  it('renders the header with the pending count', () => {
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} onSign={vi.fn()} />);
    expect(screen.getByText(/pending signature requests \(2\)/i)).toBeInTheDocument();
  });

  it('renders coop name and amount for each pending tx', () => {
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} onSign={vi.fn()} />);
    expect(screen.getByText(/Green Coop — 250 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/Harvest Coop — 100 XLM/i)).toBeInTheDocument();
  });

  it('shows a truncated destination address for each tx', () => {
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} onSign={vi.fn()} />);
    expect(screen.getByText(/GABC12345678/)).toBeInTheDocument();
    expect(screen.getByText(/GDEF98765432/)).toBeInTheDocument();
  });

  it('shows the signature count for each tx', () => {
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} onSign={vi.fn()} />);
    expect(screen.getByText(/1 signature\(s\) collected/i)).toBeInTheDocument();
    expect(screen.getByText(/2 signature\(s\) collected/i)).toBeInTheDocument();
  });
});

// ── Sign button ───────────────────────────────────────────────────────────────

describe('PendingMultisigPanel — sign button', () => {
  it('calls onSign with the tx id when Sign is clicked', () => {
    const onSign = vi.fn();
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} onSign={onSign} />);
    const signButtons = screen.getAllByRole('button', { name: /sign/i });
    fireEvent.click(signButtons[0]);
    expect(onSign).toHaveBeenCalledWith(10);
  });

  it('disables the Sign button and shows "Signing…" for the tx being signed', () => {
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} signingTxId={10} onSign={vi.fn()} />);
    const signingBtn = screen.getByRole('button', { name: /signing/i });
    expect(signingBtn).toBeDisabled();
  });

  it('does not disable Sign buttons for other txs while one is signing', () => {
    render(<PendingMultisigPanel pendingTxs={PENDING_TXS} signingTxId={10} onSign={vi.fn()} />);
    // tx id=11's button should still be enabled
    const signButtons = screen.getAllByRole('button');
    const activeBtn = signButtons.find((b) => !b.disabled);
    expect(activeBtn).toBeTruthy();
  });
});
