import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PriceHistoryChart from '../components/PriceHistoryChart';

describe('PriceHistoryChart (#432)', () => {
  it('shows "No price history available" for null data', () => {
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
    const data = [
      { recorded_at: '2024-01-01', price: '1.5' },
      { recorded_at: '2024-01-02', price: '2.0' },
    ];
    render(<PriceHistoryChart data={data} />);
    expect(screen.queryByText('No price history available.')).not.toBeInTheDocument();
    // Chart title should be visible
    expect(screen.getByText(/Price History/i)).toBeInTheDocument();
  });
});
