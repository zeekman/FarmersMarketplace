import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('../api/client', () => ({
  api: {
    getOrders: vi.fn().mockResolvedValue({ data: [
      { id: 1, product_name: 'Tomatoes', quantity: 2, unit: 'kg', farmer_name: 'Bob', status: 'paid', total_price: '10', created_at: '2024-01-01T00:00:00Z' },
      { id: 2, product_name: 'Carrots', quantity: 1, unit: 'kg', farmer_name: 'Alice', status: 'disputed', total_price: '5', created_at: '2024-01-02T00:00:00Z' },
      { id: 3, product_name: 'Apples', quantity: 3, unit: 'kg', farmer_name: 'Charlie', status: 'pending', total_price: '15', created_at: '2024-01-03T00:00:00Z' },
    ]}),
    getBundleOrders: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'buyer' } }) }));

import Orders from '../pages/Orders';

function renderOrders(initialUrl = '/orders') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Orders />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('#428 Orders status filter', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows all orders by default', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    expect(screen.getByText('Carrots')).toBeInTheDocument();
    expect(screen.getByText('Apples')).toBeInTheDocument();
  });

  it('selecting "Disputed" filter shows only disputed orders', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());

    const disputedTab = screen.getByRole('button', { name: /disputed/i });
    fireEvent.click(disputedTab);

    await waitFor(() => {
      expect(screen.getByText('Carrots')).toBeInTheDocument();
      expect(screen.queryByText('Tomatoes')).toBeNull();
      expect(screen.queryByText('Apples')).toBeNull();
    });
  });

  it('filter tabs exist for all required statuses', async () => {
    renderOrders();
    await waitFor(() => expect(screen.getByText('Tomatoes')).toBeInTheDocument());
    for (const status of ['All', 'Pending', 'Paid', 'Disputed', 'Cancelled', 'Refunded']) {
      expect(screen.getByRole('button', { name: new RegExp(status, 'i') })).toBeInTheDocument();
    }
  });
});
