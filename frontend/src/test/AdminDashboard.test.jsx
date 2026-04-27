import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    adminGetStats: vi.fn().mockResolvedValue({ data: { users: 1, products: 0, orders: 0, total_revenue_xlm: 0 } }),
    adminGetUsers: vi.fn().mockResolvedValue({
      data: [{ id: 1, name: 'Alice', email: 'alice@test.com', role: 'buyer', created_at: new Date().toISOString(), active: 1 }],
      pagination: { page: 1, pages: 1, total: 1 },
    }),
    adminGetContracts: vi.fn().mockResolvedValue({ data: [] }),
    adminGetContractAlerts: vi.fn().mockResolvedValue({ data: [] }),
    adminGetAnnouncements: vi.fn().mockResolvedValue({ data: [] }),
    adminDeactivateUser: vi.fn().mockResolvedValue({}),
  },
}));

import AdminDashboard from '../pages/AdminDashboard';
import { api } from '../api/client';

describe('AdminDashboard deactivate modal (#437)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not call adminDeactivateUser when cancel is clicked', async () => {
    render(<AdminDashboard />);
    const btn = await screen.findByRole('button', { name: /deactivate/i });
    fireEvent.click(btn);
    const cancelBtn = await screen.findByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(api.adminDeactivateUser).not.toHaveBeenCalled());
  });

  it('shows confirmation modal with correct user name', async () => {
    render(<AdminDashboard />);
    const btn = await screen.findByRole('button', { name: /deactivate/i });
    fireEvent.click(btn);
    expect(await screen.findByText(/Deactivate Alice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm deactivate/i })).toBeInTheDocument();
  });

  it('calls adminDeactivateUser after confirmation', async () => {
    render(<AdminDashboard />);
    const btn = await screen.findByRole('button', { name: /deactivate/i });
    fireEvent.click(btn);
    const confirmBtn = await screen.findByRole('button', { name: /confirm deactivate/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api.adminDeactivateUser).toHaveBeenCalledWith(1));
  });
});
