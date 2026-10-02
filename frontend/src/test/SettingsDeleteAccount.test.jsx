import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockLogout = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    updateProfile: vi.fn(),
    getSeedPhrase: vi.fn(),
    mergeWallet: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Alice', email: 'alice@example.com', role: 'buyer', publicKey: 'GABCDEFGHIJKLMNOP' },
    logout: mockLogout,
  }),
}));

import Settings from '../pages/Settings';
import { api } from '../api/client';

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  );
}

async function openDeleteModal() {
  renderSettings();
  await userEvent.click(screen.getByRole('button', { name: /^Delete Account$/i }));
  return screen.getByRole('dialog');
}

describe('#1375 Settings – delete account modal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the modal and keeps delete disabled until the phrase is typed', async () => {
    await openDeleteModal();
    const confirmBtn = screen.getByRole('button', { name: /Delete My Account/i });
    expect(confirmBtn).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('delete my account'), 'delete my account');
    expect(confirmBtn).toBeEnabled();
  });

  it('closes the modal on Cancel without deleting', async () => {
    await openDeleteModal();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes the account and logs out on confirm', async () => {
    api.deleteAccount.mockResolvedValue({});
    await openDeleteModal();
    await userEvent.type(screen.getByPlaceholderText('delete my account'), 'delete my account');
    await userEvent.click(screen.getByRole('button', { name: /Delete My Account/i }));

    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledWith(false));
    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
  });

  it('shows the balance warning on 409 and forces deletion with "Delete Anyway"', async () => {
    const balanceErr = Object.assign(new Error('balance'), {
      status: 409,
      data: { code: 'balance_warning', balance: 25.5, publicKey: 'GABCDEFGHIJKLMNOP' },
    });
    api.deleteAccount.mockRejectedValueOnce(balanceErr).mockResolvedValueOnce({});

    await openDeleteModal();
    await userEvent.type(screen.getByPlaceholderText('delete my account'), 'delete my account');
    await userEvent.click(screen.getByRole('button', { name: /Delete My Account/i }));

    expect(await screen.findByText('Wallet Balance Detected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Delete Anyway/i }));

    await waitFor(() => expect(api.deleteAccount).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
  });
});
