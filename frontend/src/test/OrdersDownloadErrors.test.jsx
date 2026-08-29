// #1204 – downloadReceipt/exportOrders bypass request()'s shared 401-retry
// logic; verify a 401 surfaces a clear, user-visible error instead of failing silently.
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

const ordersData = [
  { id: 1, product_name: 'Tomatoes', quantity: 2, unit: 'kg', farmer_name: 'Bob', status: 'paid', total_price: '10', created_at: '2024-01-01T00:00:00Z' },
];

vi.mock('../api/client', () => ({
  api: {
    getOrders: vi.fn().mockResolvedValue({ data: ordersData }),
    getBundleOrders: vi.fn().mockResolvedValue({ data: [] }),
    downloadReceipt: vi.fn(),
    exportOrders: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'buyer' } }) }));

import Orders from '../pages/Orders';
import { api } from '../api/client';

function renderOrders() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/orders']}>
        <Orders />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('#1204 Orders download/export error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getOrders.mockResolvedValue({ data: ordersData });
    api.getBundleOrders.mockResolvedValue({ data: [] });
  });

  it('shows a clear error when downloadReceipt fails with a 401 (expired session)', async () => {
    const err = new Error('Session expired');
    err.status = 401;
    api.downloadReceipt.mockRejectedValue(err);

    renderOrders();
    const downloadBtn = await screen.findByRole('button', { name: /download receipt/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
    });
    // The button must be usable again, not stuck disabled/broken.
    expect(downloadBtn).not.toBeDisabled();
  });

  it('shows a clear error when exportOrders fails with a 401 (expired session)', async () => {
    const err = new Error('Session expired');
    err.status = 401;
    api.exportOrders.mockRejectedValue(err);

    renderOrders();
    const exportToggle = await screen.findByRole('button', { name: /export/i });
    fireEvent.click(exportToggle);
    const csvBtn = screen.getByRole('button', { name: /export as csv/i });
    fireEvent.click(csvBtn);

    await waitFor(() => {
      expect(screen.getByText('Session expired')).toBeInTheDocument();
    });
  });

  it('does not silently swallow the receipt download failure', async () => {
    const err = new Error('Session expired');
    err.status = 401;
    api.downloadReceipt.mockRejectedValue(err);

    renderOrders();
    const downloadBtn = await screen.findByRole('button', { name: /download receipt/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => expect(api.downloadReceipt).toHaveBeenCalledWith(1));
    // Before the fix this error was caught and dropped with no UI feedback at all.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
  });
});
