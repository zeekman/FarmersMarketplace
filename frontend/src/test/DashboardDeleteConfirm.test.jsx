import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockProducts = [
  { id: 1, name: 'Tomatoes', price: 5, quantity: 10, unit: 'kg', flash_sale_price: null, flash_sale_ends_at: null },
];

vi.mock('../api/client', () => ({
  api: {
    getMyProducts: vi.fn().mockResolvedValue({ data: mockProducts }),
    getSales: vi.fn().mockResolvedValue({ data: [] }),
    getFarmer: vi.fn().mockResolvedValue({ data: {} }),
    getBundles: vi.fn().mockResolvedValue({ data: [] }),
    getMyCoupons: vi.fn().mockResolvedValue({ data: [] }),
    getCooperatives: vi.fn().mockResolvedValue({ data: [] }),
    getHarvestBatches: vi.fn().mockResolvedValue({ data: [] }),
    getForecast: vi.fn().mockResolvedValue({ data: [] }),
    getWaitlistAnalytics: vi.fn().mockResolvedValue({ data: [] }),
    getBundleDiscounts: vi.fn().mockResolvedValue({ data: [] }),
    deleteProduct: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Farmer Joe' } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => children,
}));

import Dashboard from '../pages/Dashboard';
import { api } from '../api/client';

describe('Dashboard delete confirmation (#455)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not call deleteProduct when Remove is clicked without confirming', async () => {
    render(<Dashboard />);
    const removeBtn = await screen.findByRole('button', { name: /remove tomatoes/i });
    fireEvent.click(removeBtn);
    // Dialog should appear, but we do NOT confirm
    expect(await screen.findByText(/Delete Tomatoes\? This cannot be undone\./i)).toBeInTheDocument();
    expect(api.deleteProduct).not.toHaveBeenCalled();
  });

  it('shows the confirmation dialog with product name', async () => {
    render(<Dashboard />);
    const removeBtn = await screen.findByRole('button', { name: /remove tomatoes/i });
    fireEvent.click(removeBtn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Delete Tomatoes\? This cannot be undone\./i)).toBeInTheDocument();
  });

  it('calls deleteProduct after confirmation', async () => {
    render(<Dashboard />);
    const removeBtn = await screen.findByRole('button', { name: /remove tomatoes/i });
    fireEvent.click(removeBtn);
    const confirmBtn = await screen.findByRole('button', { name: /confirm delete/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api.deleteProduct).toHaveBeenCalledWith(1));
  });

  it('closes dialog without deleting when Cancel is clicked', async () => {
    render(<Dashboard />);
    const removeBtn = await screen.findByRole('button', { name: /remove tomatoes/i });
    fireEvent.click(removeBtn);
    const cancelBtn = await screen.findByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.deleteProduct).not.toHaveBeenCalled();
  });
});
