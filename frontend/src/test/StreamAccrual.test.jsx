import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import StreamAccrual from '../components/StreamAccrual';

describe('StreamAccrual (#1185)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the initial accrued amount on mount', () => {
    const asOf = new Date(Date.now()).toISOString();
    render(<StreamAccrual accrued={10} asOf={asOf} rate={1} />);
    expect(screen.getByText('10.0000')).toBeTruthy();
  });

  it('ticks: displayed = accrued + rate × elapsed_seconds', async () => {
    const asOf = new Date(Date.now()).toISOString();
    render(<StreamAccrual accrued={5} asOf={asOf} rate={2} />);

    await act(async () => { vi.advanceTimersByTime(3000); });
    // 5 + 2*3 = 11
    expect(screen.getByText('11.0000')).toBeTruthy();
  });

  it('does not tick when rate is 0', async () => {
    const asOf = new Date(Date.now()).toISOString();
    render(<StreamAccrual accrued={7} asOf={asOf} rate={0} />);

    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('7.0000')).toBeTruthy();
  });

  it('stops ticking after stream end time has passed', async () => {
    const asOf = new Date(Date.now()).toISOString();
    // Simulate a past asOf — component ticks based on current time - asOf
    // After stream ends (rate goes to 0), displayed amount freezes
    const { rerender } = render(<StreamAccrual accrued={10} asOf={asOf} rate={1} />);

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('12.0000')).toBeTruthy();

    // Stream ended — parent passes rate=0
    rerender(<StreamAccrual accrued={12} asOf={asOf} rate={0} />);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('12.0000')).toBeTruthy();
  });

  it('resets display when accrued/asOf props update (server refresh)', async () => {
    const asOf = new Date(Date.now()).toISOString();
    const { rerender } = render(<StreamAccrual accrued={0} asOf={asOf} rate={1} />);

    const newAsOf = new Date(Date.now()).toISOString();
    rerender(<StreamAccrual accrued={100} asOf={newAsOf} rate={1} />);
    expect(screen.getByText('100.0000')).toBeTruthy();
  });
});
