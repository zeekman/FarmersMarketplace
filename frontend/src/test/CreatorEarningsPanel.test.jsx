// #1206 – CreatorEarningsPanel had no test coverage for the claim-earnings flow:
// zero balance disables the claim, a successful claim zeroes the balance, and a
// failed claim shows an error while leaving the balance unchanged.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CreatorEarningsPanel from '../components/dashboard/CreatorEarningsPanel';

describe('#1206 CreatorEarningsPanel claim flow', () => {
  it('disables the claim action when the balance is zero', () => {
    render(
      <CreatorEarningsPanel earnings={{ balance: 0 }} claiming={false} claimMsg={null} onClaim={vi.fn()} />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import CreatorEarningsPanel from '../../components/dashboard/CreatorEarningsPanel';

// ── Balance display ───────────────────────────────────────────────────────────

describe('CreatorEarningsPanel — balance display', () => {
  it('renders the balance formatted to 2 decimal places', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 42.5 }}
        claiming={false}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByText(/42\.50\s*XLM/i)).toBeInTheDocument();
  });

  it('shows a dash when earnings is null (loading state)', () => {
    render(
      <CreatorEarningsPanel
        earnings={null}
        claiming={false}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByText(/- XLM/i)).toBeInTheDocument();
  });
});

// ── Claim button state ────────────────────────────────────────────────────────

describe('CreatorEarningsPanel — claim button', () => {
  it('is disabled when earnings is null', () => {
    render(
      <CreatorEarningsPanel
        earnings={null}
        claiming={false}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /claim earnings/i })).toBeDisabled();
  });

  it('disables the claim action while earnings are still loading (null)', () => {
    render(<CreatorEarningsPanel earnings={null} claiming={false} claimMsg={null} onClaim={vi.fn()} />);
    expect(screen.getByRole('button', { name: /claim earnings/i })).toBeDisabled();
  });

  it('enables the claim action for a positive balance and invokes onClaim on click', () => {
    const onClaim = vi.fn();
    render(
      <CreatorEarningsPanel earnings={{ balance: 12.5 }} claiming={false} claimMsg={null} onClaim={onClaim} />
    );
    const btn = screen.getByRole('button', { name: /claim earnings/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  it('shows the updated balance as zero and a success message after a successful claim', () => {
    const { rerender } = render(
      <CreatorEarningsPanel earnings={{ balance: 12.5 }} claiming={true} claimMsg={null} onClaim={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /claiming/i })).toBeDisabled();

    // Simulate the parent updating state after a successful claim response.
    rerender(
      <CreatorEarningsPanel
        earnings={{ balance: 0 }}
        claiming={false}
        claimMsg={{ type: 'ok', text: 'Earnings claimed successfully' }}
        onClaim={vi.fn()}
      />
    );

    expect(screen.getByText('0.00 XLM')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Earnings claimed successfully');
    expect(screen.getByRole('button', { name: /claim earnings/i })).toBeDisabled();
  });

  it('shows an error and leaves the displayed balance unchanged after a failed claim', () => {
    const { rerender } = render(
      <CreatorEarningsPanel earnings={{ balance: 8 }} claiming={true} claimMsg={null} onClaim={vi.fn()} />
    );

    // Simulate the parent updating state after the contract call was rejected.
    rerender(
      <CreatorEarningsPanel
        earnings={{ balance: 8 }}
        claiming={false}
        claimMsg={{ type: 'err', text: 'Claim failed: contract call rejected' }}
        onClaim={vi.fn()}
      />
    );

    expect(screen.getByText('8.00 XLM')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Claim failed: contract call rejected');
    // Balance still positive, so the claim action remains available for retry.
    expect(screen.getByRole('button', { name: /claim earnings/i })).not.toBeDisabled();
  it('is disabled when balance is 0', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 0 }}
        claiming={false}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /claim earnings/i })).toBeDisabled();
  });

  it('is enabled when balance is greater than 0', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 10 }}
        claiming={false}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /claim earnings/i })).not.toBeDisabled();
  });

  it('shows "Claiming..." and is disabled while claiming is true', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 10 }}
        claiming={true}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    const btn = screen.getByRole('button', { name: /claiming/i });
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/claiming/i);
  });

  it('calls onClaim when clicked with a positive balance', () => {
    const onClaim = vi.fn();
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 5 }}
        claiming={false}
        claimMsg={null}
        onClaim={onClaim}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /claim earnings/i }));
    expect(onClaim).toHaveBeenCalledTimes(1);
  });
});

// ── Feedback message ──────────────────────────────────────────────────────────

describe('CreatorEarningsPanel — feedback message', () => {
  it('shows a success claimMsg', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 10 }}
        claiming={false}
        claimMsg={{ type: 'ok', text: 'Earnings claimed!' }}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('Earnings claimed!');
  });

  it('shows an error claimMsg', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 10 }}
        claiming={false}
        claimMsg={{ type: 'err', text: 'Transaction failed.' }}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByRole('status').textContent).toBe('Transaction failed.');
  });

  it('renders nothing for claimMsg when it is null', () => {
    render(
      <CreatorEarningsPanel
        earnings={{ balance: 10 }}
        claiming={false}
        claimMsg={null}
        onClaim={vi.fn()}
      />
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
