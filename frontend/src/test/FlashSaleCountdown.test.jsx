import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import FlashSaleCountdown from '../components/FlashSaleCountdown';

describe('FlashSaleCountdown (#434)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Sale ended" when endsAt is in the past', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    render(<FlashSaleCountdown endsAt={past} />);
    expect(screen.getByText('Sale ended')).toBeTruthy();
  });

  it('clears interval and shows "Sale ended" when countdown reaches zero', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const endsAt = new Date(Date.now() + 1500).toISOString();
    render(<FlashSaleCountdown endsAt={endsAt} />);

    expect(screen.queryByText('Sale ended')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Sale ended')).toBeTruthy();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('turns red when under 60 seconds remain', () => {
    const endsAt = new Date(Date.now() + 30000).toISOString();
    render(<FlashSaleCountdown endsAt={endsAt} />);
    const el = screen.getByText(/Flash sale ends in/i);
    expect(el.style.color).toBe('red');
  });

  it('applies fast pulse class when under 10 seconds remain', () => {
    const endsAt = new Date(Date.now() + 5000).toISOString();
    render(<FlashSaleCountdown endsAt={endsAt} />);
    const el = screen.getByText(/Flash sale ends in/i);
    expect(el.className).toContain('fsc-pulse-fast');
  });

  it('has aria-live="assertive" region', () => {
    const endsAt = new Date(Date.now() + 5000).toISOString();
    render(<FlashSaleCountdown endsAt={endsAt} />);
    const live = document.querySelector('[aria-live="assertive"]');
    expect(live).toBeTruthy();
  });

  it('uses 250ms interval when under 10 seconds remain', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const endsAt = new Date(Date.now() + 8000).toISOString();
    render(<FlashSaleCountdown endsAt={endsAt} />);
    // The initial render with totalSeconds=8 should schedule 250ms interval
    const calls = setIntervalSpy.mock.calls.map(c => c[1]);
    expect(calls).toContain(250);
  });
});
