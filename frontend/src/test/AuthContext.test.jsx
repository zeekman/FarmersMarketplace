import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    refresh: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

import { AuthProvider, useAuth } from '../context/AuthContext';

function Profile() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span>{loading ? 'loading' : 'done'}</span>
      <span>{user?.role ?? 'no-role'}</span>
      <span>{user?.name ?? 'no-name'}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('fetches the verified user profile after refresh and does not trust JWT payload role', async () => {
    const maliciousToken = 'header.eyJpZCI6MSwicm9sZSI6ImZhcm1lciJ9.signature';
    const verifiedProfile = {
      id: 1,
      name: 'Alice Farmer',
      email: 'alice@farm.test',
      role: 'buyer',
      publicKey: 'GPUBKEY',
      referralCode: 'REF123',
    };

    const { api } = await import('../api/client');
    api.refresh.mockResolvedValue(maliciousToken);
    api.getCurrentUser.mockResolvedValue(verifiedProfile);

    render(
      <AuthProvider>
        <Profile />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(screen.getByText('buyer')).toBeInTheDocument();
    expect(api.getCurrentUser).toHaveBeenCalled();
  });
});
