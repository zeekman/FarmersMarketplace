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

describe('AddressBook — address limit indicator and error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createAddress.mockResolvedValue({});
    api.updateAddress.mockResolvedValue({});
    api.deleteAddress.mockResolvedValue({});
    api.setDefaultAddress.mockResolvedValue({});
  });

  it('shows "N of MAX addresses used" indicator with the count from the API', async () => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress], limit: 10 });
    render(<AddressBook />);
    expect(await screen.findByText('1 of 10 addresses used')).toBeInTheDocument();
  });

  it('shows "0 of MAX addresses used" when there are no addresses', async () => {
    api.getAddresses.mockResolvedValue({ data: [], limit: 10 });
    render(<AddressBook />);
    expect(await screen.findByText('0 of 10 addresses used')).toBeInTheDocument();
  });

  it('uses a default limit of 10 when the API response omits limit', async () => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress] }); // no limit field
    render(<AddressBook />);
    expect(await screen.findByText('1 of 10 addresses used')).toBeInTheDocument();
  });

  it('indicator reflects a non-default limit returned by the API', async () => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress], limit: 5 });
    render(<AddressBook />);
    expect(await screen.findByText('1 of 5 addresses used')).toBeInTheDocument();
  });

  it('the "+ Add Address" button is enabled below the limit', async () => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress], limit: 10 });
    render(<AddressBook />);
    const addBtn = await screen.findByRole('button', { name: /\+ add address/i });
    expect(addBtn).not.toBeDisabled();
  });

  it('disables the "+ Add Address" button when the address count equals the limit', async () => {
    const addresses = Array.from({ length: 3 }, (_, i) => ({
      ...mockAddress,
      id: i + 1,
      label: `Address ${i + 1}`,
    }));
    api.getAddresses.mockResolvedValue({ data: addresses, limit: 3 });
    render(<AddressBook />);
    const addBtn = await screen.findByRole('button', { name: /\+ add address/i });
    expect(addBtn).toBeDisabled();
  });

  it('shows "N of N addresses used" indicator in error style at limit', async () => {
    const addresses = Array.from({ length: 3 }, (_, i) => ({
      ...mockAddress,
      id: i + 1,
      label: `Address ${i + 1}`,
    }));
    api.getAddresses.mockResolvedValue({ data: addresses, limit: 3 });
    render(<AddressBook />);
    expect(await screen.findByText('3 of 3 addresses used')).toBeInTheDocument();
  });

  it('shows an actionable message when the server returns address_limit_reached', async () => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress], limit: 10 });
    const limitErr = Object.assign(new Error('Maximum number of addresses reached'), {
      code: 'address_limit_reached',
    });
    api.createAddress.mockRejectedValue(limitErr);

    render(<AddressBook />);

    // Open the add modal
    const addBtn = await screen.findByRole('button', { name: /\+ add address/i });
    fireEvent.click(addBtn);

    // Fill in the form and submit
    fireEvent.change(screen.getByLabelText(/label \(e\.g\., home, work\)/i), {
      target: { value: 'Work' },
    });
    fireEvent.change(screen.getByLabelText(/street address/i), {
      target: { value: '1 Elm St' },
    });
    fireEvent.change(screen.getByLabelText(/city/i), {
      target: { value: 'Lagos' },
    });
    fireEvent.change(screen.getByLabelText(/country/i), {
      target: { value: 'Nigeria' },
    });

    // Use exact name to distinguish from the "+ Add Address" header button
    fireEvent.click(screen.getByRole('button', { name: 'Add Address' }));

    await waitFor(() =>
      expect(
        screen.getByText(/you've reached the 10-address limit/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/delete an address you no longer need/i),
    ).toBeInTheDocument();
  });

  it('falls back to the raw server message for non-limit errors', async () => {
    api.getAddresses.mockResolvedValue({ data: [mockAddress], limit: 10 });
    const genericErr = Object.assign(new Error('Validation failed'), {
      code: 'validation_error',
    });
    api.createAddress.mockRejectedValue(genericErr);

    render(<AddressBook />);

    const addBtn = await screen.findByRole('button', { name: /\+ add address/i });
    fireEvent.click(addBtn);

    fireEvent.change(screen.getByLabelText(/label \(e\.g\., home, work\)/i), {
      target: { value: 'Work' },
    });
    fireEvent.change(screen.getByLabelText(/street address/i), {
      target: { value: '1 Elm St' },
    });
    fireEvent.change(screen.getByLabelText(/city/i), {
      target: { value: 'Lagos' },
    });
    fireEvent.change(screen.getByLabelText(/country/i), {
      target: { value: 'Nigeria' },
    });

    // Use exact name to distinguish from the "+ Add Address" header button
    fireEvent.click(screen.getByRole('button', { name: 'Add Address' }));

    await waitFor(() =>
      expect(screen.getByText('Validation failed')).toBeInTheDocument(),
    );
  });
});
