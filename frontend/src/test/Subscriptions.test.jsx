import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getSubscriptions: vi.fn().mockResolvedValue({
      data: [{
        id: 1,
        product_name: 'Tomatoes',
        quantity: 2,
        unit: 'kg',
        frequency: 'weekly',
        product_price: '5',
        status: 'active',
        next_order_at: '2026-05-01T00:00:00.000Z',
        next_billing_at: '2026-06-01T00:00:00.000Z',
      }],
    }),
  },
}));

import Subscriptions from '../pages/Subscriptions';
import { api } from '../api/client';

describe('Subscriptions next billing date (#438)', () => {
  it('renders formatted next_billing_at date', async () => {
    render(<Subscriptions />);
    const formatted = new Date('2026-06-01T00:00:00.000Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    expect(await screen.findByText(`Next billing: ${formatted}`)).toBeInTheDocument();
  });

  it('renders "Billing date not set" when next_billing_at is null', async () => {
    api.getSubscriptions.mockResolvedValueOnce({
      data: [{
        id: 2,
        product_name: 'Carrots',
        quantity: 1,
        unit: 'kg',
        frequency: 'monthly',
        product_price: '3',
        status: 'active',
        next_order_at: '2026-05-01T00:00:00.000Z',
        next_billing_at: null,
      }],
    });
    render(<Subscriptions />);
    expect(await screen.findByText('Next billing: Billing date not set')).toBeInTheDocument();
  });
});
