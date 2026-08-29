import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('../context/LoadingContext', () => ({
  useLoading: vi.fn(),
}));

import { useLoading } from '../context/LoadingContext';
import LoadingSpinner from '../components/LoadingSpinner';

describe('LoadingSpinner (#1184)', () => {
  it('renders nothing when loading is false', () => {
    useLoading.mockReturnValue({ loading: false });
    const { container } = render(<LoadingSpinner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when loading is true', () => {
    useLoading.mockReturnValue({ loading: true });
    const { container } = render(<LoadingSpinner />);
    expect(container.firstChild).not.toBeNull();
  });

  it('overlay uses fixed position (covers full viewport)', () => {
    useLoading.mockReturnValue({ loading: true });
    const { container } = render(<LoadingSpinner />);
    expect(container.firstChild.style.position).toBe('fixed');
  });
});
