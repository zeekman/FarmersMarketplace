import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getAddresses: vi.fn(),
    createAddress: vi.fn(),
    updateAddress: vi.fn(),
    deleteAddress: vi.fn(),
    setDefaultAddress: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'buyer' } }),
}));

import { api } from '../api/client';
import AddressBook from '../pages/AddressBook';

describe('AddressBook country select (#1187)', () => {
  beforeEach(() => {
    api.getAddresses.mockResolvedValue({ data: [] });
    api.createAddress.mockResolvedValue({});
  });

  async function openAddModal() {
    render(<AddressBook />);
    await screen.findByRole('button', { name: /\+ add address/i });
    fireEvent.click(screen.getByRole('button', { name: /\+ add address/i }));
    await screen.findByRole('dialog');
  }

  it('renders a <select> (not a text input) for the country field', async () => {
    await openAddModal();
    const countrySelect = screen.getByRole('combobox', { name: /country/i });
    expect(countrySelect.tagName).toBe('SELECT');
  });

  it('country select includes the same ISO codes used by ProductForm allowed regions', async () => {
    await openAddModal();
    const countrySelect = screen.getByRole('combobox', { name: /country/i });
    const options = [...countrySelect.querySelectorAll('option')].map(o => o.value);
    expect(options).toContain('KE');
    expect(options).toContain('US');
    expect(options).toContain('NG');
  });

  it('submits the selected country code (not a free-text name)', async () => {
    await openAddModal();

    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Home' } });
    fireEvent.change(screen.getByLabelText(/street/i), { target: { value: '1 Road' } });
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: 'Lagos' } });
    fireEvent.change(screen.getByRole('combobox', { name: /country/i }), { target: { value: 'NG' } });

    fireEvent.click(screen.getByRole('button', { name: /add address/i }));

    await waitFor(() => {
      expect(api.createAddress).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'NG' })
      );
    });
  });
});
