import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      ...actual.api,
      get2FAStatus: vi.fn(),
      setup2FA: vi.fn(),
      verify2FA: vi.fn(),
      disable2FA: vi.fn(),
    },
  };
});

import TwoFactorAuth from '../components/TwoFactorAuth';
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  api.get2FAStatus.mockResolvedValue({ enabled: false });
  api.setup2FA.mockResolvedValue({
    secret: 'SECRET123',
    qrCode: 'data:image/png;base64,qr',
    backupCodes: ['BACKUP-ONE', 'BACKUP-TWO'],
  });
});

async function startSetup() {
  render(<TwoFactorAuth />);
  await waitFor(() => expect(screen.getByRole('button', { name: /enable 2fa/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /enable 2fa/i }));
  await waitFor(() => expect(screen.getByAltText('2FA QR Code')).toBeInTheDocument());
}

describe('TwoFactorAuth', () => {
  it('shows the QR code and backup codes after setup', async () => {
    await startSetup();
    expect(screen.getByText('SECRET123')).toBeInTheDocument();
    expect(screen.getByText('BACKUP-ONE')).toBeInTheDocument();
    expect(screen.getByText('BACKUP-TWO')).toBeInTheDocument();
  });

  it('keeps verification disabled until six digits are entered', async () => {
    await startSetup();
    const verify = screen.getByRole('button', { name: /verify & enable/i });
    const input = screen.getByPlaceholderText('000000');
    expect(verify).toBeDisabled();
    fireEvent.change(input, { target: { value: '12345' } });
    expect(verify).toBeDisabled();
    fireEvent.change(input, { target: { value: '123456' } });
    expect(verify).toBeEnabled();
  });

  it('moves to the enabled state after successful verification', async () => {
    api.verify2FA.mockResolvedValue({});
    await startSetup();
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify & enable/i }));
    await waitFor(() => expect(screen.getByText(/2fa is enabled/i)).toBeInTheDocument());
    expect(api.verify2FA).toHaveBeenCalledWith({
      secret: 'SECRET123', code: '123456', backupCodes: ['BACKUP-ONE', 'BACKUP-TWO'],
    });
  });

  it('requires confirmation through the dialog before disabling 2FA', async () => {
    api.get2FAStatus.mockResolvedValue({ enabled: true });
    api.disable2FA.mockResolvedValue({});
    const nativeConfirm = vi.spyOn(window, 'confirm');
    render(<TwoFactorAuth />);
    const disableBtn = await screen.findByRole('button', { name: /disable 2fa/i });

    // Cancel keeps 2FA enabled
    fireEvent.click(disableBtn);
    let dialog = await screen.findByRole('alertdialog', { name: /disable two-factor authentication/i });
    expect(dialog).toHaveAccessibleDescription(/less secure/i);
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.disable2FA).not.toHaveBeenCalled();

    // Escape also cancels
    fireEvent.click(disableBtn);
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.disable2FA).not.toHaveBeenCalled();

    // Confirm disables
    fireEvent.click(disableBtn);
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /disable 2fa/i }));
    await waitFor(() => expect(api.disable2FA).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/2fa disabled/i)).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });
});