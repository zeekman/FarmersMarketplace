// #425 – ErrorBoundary reports errors to VITE_ERROR_REPORTING_URL when set
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ErrorBoundary from '../components/ErrorBoundary';

function Bomb() {
  throw new Error('test explosion');
}

beforeEach(() => {
  vi.stubEnv('VITE_ERROR_REPORTING_URL', 'https://errors.example.com/report');
  global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  // Suppress React's console.error for expected boundary errors
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('calls fetch with error details when VITE_ERROR_REPORTING_URL is set', () => {
  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  );

  expect(screen.getByText(/something went wrong/i)).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledWith(
    'https://errors.example.com/report',
    expect.objectContaining({ method: 'POST' })
  );
});

test('does not call fetch when VITE_ERROR_REPORTING_URL is not set', () => {
  vi.stubEnv('VITE_ERROR_REPORTING_URL', '');
  global.fetch = vi.fn();

  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  );

  expect(global.fetch).not.toHaveBeenCalled();
});
