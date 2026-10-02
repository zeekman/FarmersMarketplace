import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getSubscriptions: vi.fn(),
    searchProducts: vi.fn().mockResolvedValue({ data: [] }),
    createSubscription: vi.fn(),
    pauseSubscription: vi.fn().mockResolvedValue({}),
    resumeSubscription: vi.fn().mockResolvedValue({}),
    cancelSubscription: vi.fn().mockResolvedValue({}),
  },
}));

import Subscriptions from '../pages/Subscriptions';
import { api } from '../api/client';

const baseSub = {
  id: 5,
  product_name: 'Tomatoes',
  quantity: 2,
  unit: 'kg',
  frequency: 'weekly',
  product_price: '5',
  next_order_at: '2026-05-01T00:00:00.000Z',
  next_billing_at: null,
};

const withStatus = status => ({ data: [{ ...baseSub, status }] });

describe('#1376 Subscriptions list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a single row with product, quantity, frequency, next amount and status', async () => {
    api.getSubscriptions.mockResolvedValue(withStatus('active'));
    render(<Subscriptions />);

    expect(await screen.findByText('Tomatoes')).toBeInTheDocument();
    expect(screen.getAllByText('Tomatoes')).toHaveLength(1);
    expect(screen.getByText(/2 kg · Every week/)).toBeInTheDocument();
    expect(screen.getByText('10.00 XLM')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('pause → resume → cancel call the matching api methods', async () => {
    api.getSubscriptions
      .mockResolvedValueOnce(withStatus('active'))
      .mockResolvedValueOnce(withStatus('paused'))
      .mockResolvedValueOnce(withStatus('active'))
      .mockResolvedValue(withStatus('cancelled'));

    render(<Subscriptions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.pauseSubscription).toHaveBeenCalledWith(5));

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.resumeSubscription).toHaveBeenCalledWith(5));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel Subscription' }));
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledWith(5));

    expect(await screen.findByText('Subscription cancelled.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('keeps the subscription when the cancel dialog is dismissed', async () => {
    api.getSubscriptions.mockResolvedValue(withStatus('active'));
    render(<Subscriptions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep Subscription' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.cancelSubscription).not.toHaveBeenCalled();
  });
});
