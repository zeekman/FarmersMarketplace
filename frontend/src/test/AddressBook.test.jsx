import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getAddresses: vi.fn(),
    deleteAddress: vi.fn(),
    createAddress: vi.fn(),
    updateAddress: vi.fn(),
    setDefaultAddress: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'buyer' } }),
}));

import { api } from '../api/client';
import AddressBook from '../pages/AddressBook';

const mockAddress = {
  id: 1,
  label: 'Home',
  street: '123 Main St',
  city: 'Nairobi',
  country: 'Kenya',
  postal_code: '00100',
  is_default: false,
};

describe('AddressBook delete confirmation (#430)', () => {
  beforeEach(() => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress] });
    api.deleteAddress.mockReset();
    api.deleteAddress.mockResolvedValue({});
  });

  it('shows confirmation dialog when delete is clicked', async () => {
    render(<AddressBook />);
    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete this address\? This cannot be undone\./i)).toBeInTheDocument();
  });

  it('does not call deleteAddress when Cancel is clicked', async () => {
    render(<AddressBook />);
    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(api.deleteAddress).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls deleteAddress only after confirming', async () => {
    render(<AddressBook />);
    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);
    // Click the Delete button inside the dialog
    const dialog = screen.getByRole('dialog');
    const confirmBtn = dialog.querySelector('button:last-child');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api.deleteAddress).toHaveBeenCalledWith(1));
  });

  it('dismisses dialog on Escape key', async () => {
    render(<AddressBook />);
    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteAddress).not.toHaveBeenCalled();
  });
});
