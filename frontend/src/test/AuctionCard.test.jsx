import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../api/client', () => ({ api: { placeBid: vi.fn(), getAuction: vi.fn() } }));

import AuctionCard from '../components/AuctionCard';
import { api } from '../api/client';

const baseAuction = {
  id: 1,
  product_name: 'Fresh Corn',
  farmer_name: 'Alice',
  current_bid: 5,
  start_price: 3,
  bid_count: 2,
  status: 'active',
};

describe('AuctionCard countdown timer (#440)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows "Auction ended" and disables bid button when auction has ended', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    render(<AuctionCard auction={{ ...baseAuction, ends_at: past }} onBid={vi.fn()} />);
    expect(screen.getByText('Auction ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /auction ended/i })).toBeDisabled();
  });

  it('counts down and clears interval on unmount', () => {
    const future = new Date(Date.now() + 10000).toISOString();
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = render(<AuctionCard auction={{ ...baseAuction, ends_at: future }} onBid={vi.fn()} />);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/left/i)).toBeInTheDocument();

    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('transitions to "Auction ended" when timer reaches zero', () => {
    const future = new Date(Date.now() + 2000).toISOString();
    render(<AuctionCard auction={{ ...baseAuction, ends_at: future }} onBid={vi.fn()} />);
    expect(screen.getByText(/left/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Auction ended')).toBeInTheDocument();
  });

  it('disables the bid form live once ends_at passes while the page stays open, without a remount (#1201)', () => {
    const future = new Date(Date.now() + 3000).toISOString();
    const { container } = render(
      <AuctionCard auction={{ ...baseAuction, ends_at: future }} onBid={vi.fn()} />
    );
    const cardNode = container.firstChild;

    // Still active: bid input present, button enabled
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /place bid/i })).not.toBeDisabled();

    act(() => { vi.advanceTimersByTime(4000); });

    // Same DOM subtree (no remount) that has now transitioned live
    expect(container.firstChild).toBe(cardNode);
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(screen.getByRole('button', { name: /auction ended/i })).toBeDisabled();
  });
});

describe('AuctionCard polling (#766)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.getAuction.mockResolvedValue({ id: 1, ...baseAuction, current_bid: 10, bid_count: 3 });
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('starts polling when auction is active', async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    render(<AuctionCard auction={{ ...baseAuction, ends_at: future }} onBid={vi.fn()} />);

    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(api.getAuction).toHaveBeenCalledWith(1);
  });

  it('does not poll when auction is not active', async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    render(<AuctionCard auction={{ ...baseAuction, status: 'ended', ends_at: future }} onBid={vi.fn()} />);

    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(api.getAuction).not.toHaveBeenCalled();
  });

  it('stops polling on unmount', async () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const future = new Date(Date.now() + 60000).toISOString();
    const { unmount } = render(<AuctionCard auction={{ ...baseAuction, ends_at: future }} onBid={vi.fn()} />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('shows LIVE badge on active auction', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    render(<AuctionCard auction={{ ...baseAuction, ends_at: future }} onBid={vi.fn()} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });
});
