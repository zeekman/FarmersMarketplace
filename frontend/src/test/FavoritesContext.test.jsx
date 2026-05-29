import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { FavoritesProvider, useFavorites } from '../context/FavoritesContext';

const mockAddFavorite = vi.fn();
const mockRemoveFavorite = vi.fn();
const mockGetFavorites = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    addFavorite: (...args) => mockAddFavorite(...args),
    removeFavorite: (...args) => mockRemoveFavorite(...args),
    getFavorites: (...args) => mockGetFavorites(...args),
  },
}));

// Stable user object — must not change reference between renders
const BUYER_USER = { id: 1, role: 'buyer' };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: BUYER_USER }),
}));

function TestConsumer({ productId }) {
  const { isFavorited, toggleFavorite } = useFavorites();
  return (
    <div>
      <span data-testid="status">{isFavorited(productId) ? 'favorited' : 'not-favorited'}</span>
      <button onClick={() => toggleFavorite(productId).catch(() => {})}>toggle</button>
    </div>
  );
}

function renderWithProvider(productId = 42) {
  return render(
    <FavoritesProvider>
      <TestConsumer productId={productId} />
    </FavoritesProvider>
  );
}

describe('FavoritesContext server sync (#449)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFavorites.mockResolvedValue({ data: [] });
    mockAddFavorite.mockResolvedValue({ success: true });
    mockRemoveFavorite.mockResolvedValue({ success: true });
  });

  it('fetches favorites from server on mount', async () => {
    mockGetFavorites.mockResolvedValue({ data: [{ id: 42 }] });
    renderWithProvider(42);

    await waitFor(() => {
      expect(mockGetFavorites).toHaveBeenCalledOnce();
      expect(screen.getByTestId('status').textContent).toBe('favorited');
    });
  });

  it('calls addFavorite when toggling an un-favorited product', async () => {
    renderWithProvider(42);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('not-favorited'));

    await act(async () => {
      screen.getByText('toggle').click();
    });

    expect(mockAddFavorite).toHaveBeenCalledWith(42);
    expect(mockRemoveFavorite).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('favorited');
  });

  it('calls removeFavorite when toggling an already-favorited product', async () => {
    mockGetFavorites.mockResolvedValue({ data: [{ id: 42 }] });
    renderWithProvider(42);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('favorited'));

    await act(async () => {
      screen.getByText('toggle').click();
    });

    expect(mockRemoveFavorite).toHaveBeenCalledWith(42);
    expect(mockAddFavorite).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('not-favorited');
  });

  it('rolls back optimistic update on API failure', async () => {
    mockAddFavorite.mockRejectedValue(new Error('network error'));
    renderWithProvider(42);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('not-favorited'));

    await act(async () => {
      screen.getByText('toggle').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('not-favorited');
    });
  });
});
