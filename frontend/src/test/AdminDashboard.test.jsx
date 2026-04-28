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
    adminGetOrders: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pages: 1, total: 0 } }),
    adminGetContracts: vi.fn().mockResolvedValue({ data: [] }),
    adminGetContractAlerts: vi.fn().mockResolvedValue({ data: [] }),
    adminGetAnnouncements: vi.fn().mockResolvedValue({ data: [] }),
    adminDeactivateUser: vi.fn().mockResolvedValue({}),
    adminRecordContractUpgrade: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import AdminDashboard from '../pages/AdminDashboard';
import { api } from '../api/client';

const VALID_HASH = 'a'.repeat(64);

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

describe('AdminDashboard WASM hash validation (#457)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function getOldHashInput() {
    return screen.getByPlaceholderText(/previous wasm hash/i);
  }
  function getNewHashInput() {
    return screen.getByPlaceholderText(/new wasm hash/i);
  }

  it('shows no error for a valid 64-char hex hash', async () => {
    render(<AdminDashboard />);
    // open the detail panel by simulating a contract in state
    // We test the validation helper directly via the input
    const input = getOldHashInput();
    fireEvent.change(input, { target: { value: VALID_HASH } });
    await waitFor(() => {
      expect(screen.queryByText(/wasm hash must be a 64-character hex string/i)).not.toBeInTheDocument();
    });
  });

  it('shows error for a hash that is too short', async () => {
    render(<AdminDashboard />);
    const input = getOldHashInput();
    fireEvent.change(input, { target: { value: 'abc123' } });
    expect(await screen.findByText(/wasm hash must be a 64-character hex string/i)).toBeInTheDocument();
  });

  it('shows error for non-hex characters', async () => {
    render(<AdminDashboard />);
    const input = getNewHashInput();
    fireEvent.change(input, { target: { value: 'z'.repeat(64) } });
    expect(await screen.findByText(/wasm hash must be a 64-character hex string/i)).toBeInTheDocument();
  });

  it('save button is disabled when hash is invalid', async () => {
    render(<AdminDashboard />);
    const input = getOldHashInput();
    fireEvent.change(input, { target: { value: 'tooshort' } });
    const saveBtn = screen.getByRole('button', { name: /save upgrade record/i });
    expect(saveBtn).toBeDisabled();
  });

  it('save button is enabled when both hashes are valid', async () => {
    render(<AdminDashboard />);
    fireEvent.change(getOldHashInput(), { target: { value: VALID_HASH } });
    fireEvent.change(getNewHashInput(), { target: { value: 'b'.repeat(64) } });
    const saveBtn = screen.getByRole('button', { name: /save upgrade record/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
  });
});
