import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('../api/client', () => ({
  api: {
    login: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

import { api } from '../api/client';
import { LoginPage } from '../pages/Auth';

function renderLogin() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

/**
 * Covers #784: on a failed login (non-2xx response) the password field is
 * cleared by resetting the controlled state, the email is retained, the
 * password input regains focus, and the error is shown inline in the
 * form's error region rather than via alert/toast.
 */
describe('Auth login failed behaviour (#784)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the password field but retains the email after a failed login', async () => {
    api.login.mockRejectedValue(new Error('Invalid credentials'));
    renderLogin();

    const email = screen.getByLabelText(/email/i);
    const password = screen.getByLabelText(/password/i);

    fireEvent.change(email, { target: { value: 'user@example.com' } });
    fireEvent.change(password, { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => expect(screen.getByText(/incorrect email or password/i)).toBeInTheDocument());

    expect(email.value).toBe('user@example.com');
    expect(password.value).toBe('');
  });

  it('refocuses the password field after a failed login', async () => {
    api.login.mockRejectedValue(new Error('Invalid credentials'));
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => expect(screen.getByLabelText(/password/i)).toHaveFocus());
  });

  it('shows the error inline in the form error region, not via alert/toast', async () => {
    const alertSpy = vi.spyOn(window, 'alert');
    api.login.mockRejectedValue(new Error('Invalid credentials'));
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    const errorRegion = await screen.findByText(/incorrect email or password/i);
    expect(errorRegion).toBeInTheDocument();
    expect(errorRegion).toHaveAttribute('role', 'alert');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not clear the password on successful login', async () => {
    api.login.mockResolvedValue({ token: 't', user: { role: 'buyer' } });
    renderLogin();

    const password = screen.getByLabelText(/password/i);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(password, { target: { value: 'Correct1' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => expect(api.login).toHaveBeenCalled());
    // Success path navigates away rather than clearing the password field.
    expect(password.value).toBe('Correct1');
  });
});
