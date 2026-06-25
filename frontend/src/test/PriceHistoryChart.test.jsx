import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getPriceHistory: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

import PriceHistoryChart from '../components/PriceHistoryChart';
import { api } from '../api/client';

const twoPoints = [
  { recorded_at: '2024-01-01', price: '1.5' },
  { recorded_at: '2024-01-02', price: '2.0' },
];

describe('PriceHistoryChart (#432)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows "No price history available" for null data (no productId)', () => {
    render(<PriceHistoryChart data={null} />);
    expect(screen.getByText('No price history available.')).toBeInTheDocument();
  });

  it('shows "No price history available" for empty array', () => {
    render(<PriceHistoryChart data={[]} />);
    expect(screen.getByText('No price history available.')).toBeInTheDocument();
  });

  it('shows "No price history available" for single data point', () => {
    render(<PriceHistoryChart data={[{ recorded_at: '2024-01-01', price: '1.5' }]} />);
    expect(screen.getByText('No price history available.')).toBeInTheDocument();
  });

  it('renders chart for multiple data points', () => {
    render(<PriceHistoryChart data={twoPoints} />);
    expect(screen.queryByText('No price history available.')).not.toBeInTheDocument();
    expect(screen.getByText(/Price History/i)).toBeInTheDocument();
  });

  it('renders range toggle buttons', () => {
    render(<PriceHistoryChart data={twoPoints} />);
    expect(screen.getByRole('button', { name: '7D' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30D' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  });

  it('fetches with 7d range when productId provided and 7D clicked', async () => {
    api.getPriceHistory.mockResolvedValue({ data: twoPoints });
    render(<PriceHistoryChart productId={42} />);
    fireEvent.click(screen.getByRole('button', { name: '7D' }));
    await waitFor(() => expect(api.getPriceHistory).toHaveBeenCalledWith(42, '7d'));
  });

  it('fetches with all range when All clicked', async () => {
    api.getPriceHistory.mockResolvedValue({ data: twoPoints });
    render(<PriceHistoryChart productId={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(api.getPriceHistory).toHaveBeenCalledWith(42, 'all'));
  });

  it('shows empty state when range returns no data', async () => {
    api.getPriceHistory.mockResolvedValue({ data: [] });
    render(<PriceHistoryChart productId={42} />);
    await waitFor(() => expect(screen.getByText('No price history available.')).toBeInTheDocument());
  });
});
