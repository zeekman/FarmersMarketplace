import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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
    user: { id: 1, name: 'Alice', email: 'alice@example.com', role: 'buyer' },
    logout: vi.fn(),
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

describe('#454 Settings – save confirmation toast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows success toast after successful save', async () => {
    api.updateProfile.mockResolvedValue({});
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully.')).toBeInTheDocument();
    });
  });

  it('shows error toast when save fails', async () => {
    api.updateProfile.mockRejectedValue(new Error('Network error'));
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('toast has aria-live polite for screen reader announcement', async () => {
    api.updateProfile.mockResolvedValue({});
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      const toast = screen.getByRole('status');
      expect(toast).toHaveAttribute('aria-live', 'polite');
    });
  });
});
