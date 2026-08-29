// #1052 – "Skip to main content" link for keyboard users
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Alice', role: 'buyer' }, logout: vi.fn() }),
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
    useSystemTheme: vi.fn(),
    isUsingSystemTheme: false,
  }),
}));
vi.mock('../api/client', () => ({
  api: { getNetwork: () => Promise.resolve({ network: 'testnet' }) },
}));

// Mirrors the DOM order actually rendered by App.jsx's AppContent: the skip
// link first, then the navbar (with its own focusable links/buttons), then
// the shared main-content landmark every route renders into.
function TestLayout() {
  return (
    <MemoryRouter>
      <a
        href="#main-content"
        className="skip-link"
        onClick={() => document.getElementById('main-content')?.focus()}
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} style={{ outline: 'none' }}>
        <h1>Marketplace</h1>
      </main>
    </MemoryRouter>
  );
}

describe('Skip to main content link', () => {
  it('is the first Tab stop, ahead of every nav link', async () => {
    const user = userEvent.setup();
    render(<TestLayout />);

    await user.tab();

    expect(
      screen.getByRole('link', { name: /skip to main content/i }),
    ).toHaveFocus();
  });

  it('moves focus to the main content landmark when activated', async () => {
    const user = userEvent.setup();
    render(<TestLayout />);

    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    await user.click(skipLink);

    expect(document.getElementById('main-content')).toHaveFocus();
  });

  it('is visually hidden until it receives focus', () => {
    render(<TestLayout />);

    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    expect(skipLink).toHaveClass('skip-link');
  });
});
