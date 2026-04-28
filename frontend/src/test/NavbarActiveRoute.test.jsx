// #424 – Navbar applies active style to the current route link
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Alice', role: 'buyer' }, logout: vi.fn() }),
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('../api/client', () => ({
  api: { getNetwork: () => Promise.resolve({ network: 'testnet' }) },
}));

test('Marketplace link has active (bold/underline) style when on /marketplace', () => {
  render(
    <MemoryRouter initialEntries={['/marketplace']}>
      <Navbar />
    </MemoryRouter>
  );

  const links = screen.getAllByRole('link', { name: /browse/i });
  const activeLink = links.find(l => l.getAttribute('href') === '/marketplace');
  expect(activeLink).toBeTruthy();

  const style = activeLink.style;
  // Active style sets fontWeight 700 and textDecoration underline
  expect(style.fontWeight === '700' || style.textDecoration === 'underline').toBe(true);
});
