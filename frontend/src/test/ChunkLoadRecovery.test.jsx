// #1205 – a stale-deploy chunk-load failure (React.lazy's dynamic import()
// rejecting) must show a recoverable "refresh for latest version" state,
// not an unhandled rejection / blank white screen.
import React, { lazy, Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from '../components/ErrorBoundary';
import PageLoader from '../components/PageLoader';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLazyRoute(importer) {
  const LazyPage = lazy(importer);
  return render(
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <LazyPage />
      </Suspense>
    </ErrorBoundary>
  );
}

describe('#1205 chunk-load failure recovery', () => {
  it('shows the loading fallback before the chunk resolves', () => {
    renderLazyRoute(() => new Promise(() => {}));
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
  });

  it('shows a recoverable "new version available" state (not a blank page) when the chunk import rejects', async () => {
    const importer = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Wallet-abc123.js'));

    renderLazyRoute(importer);

    await waitFor(() => {
      expect(screen.getByText(/new version is available/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    // Must not fall back to a blank/empty document body.
    expect(document.body.textContent.trim().length).toBeGreaterThan(0);
  });

  it('falls back to the generic error state for a non-chunk error', async () => {
    const importer = () => Promise.reject(new Error('totally unrelated render crash'));

    renderLazyRoute(importer);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });
});
