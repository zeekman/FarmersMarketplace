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
    // Sale ends in 1 second
    const endsAt = new Date(Date.now() + 1500).toISOString();
    render(<FlashSaleCountdown endsAt={endsAt} />);

    // Before expiry: shows countdown
    expect(screen.queryByText('Sale ended')).toBeNull();

    // Advance past the end time
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Sale ended')).toBeTruthy();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
