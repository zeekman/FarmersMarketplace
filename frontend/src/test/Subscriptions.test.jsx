import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    cancelSubscription: vi.fn().mockResolvedValue({}),
  },
}));

import Subscriptions from '../pages/Subscriptions';
import { api } from '../api/client';
import { expectNoA11yViolations } from './a11y';

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

describe('Subscriptions cancel confirmation (#1399)', () => {
  it('cancels only after confirming in the accessible dialog', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    render(<Subscriptions />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    let dialog = await screen.findByRole('alertdialog', { name: 'Cancel Subscription' });
    expect(dialog).toHaveTextContent('Tomatoes');
    expect(within(dialog).getByRole('button', { name: 'Keep Subscription' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep Subscription' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.cancelSubscription).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Cancel Subscription' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel Subscription' }));
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledWith(1));
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });
});

describe('accessibility (#1397)', () => {
  it('has no detectable axe violations', async () => {
    const { container } = render(<Subscriptions />);
    await expectNoA11yViolations(container);
  }, 15000);
});
