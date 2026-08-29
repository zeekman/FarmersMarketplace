import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import PageLoader from '../components/PageLoader';

describe('PageLoader (#1184)', () => {
  it('mounts without error', () => {
    const { container } = render(<PageLoader />);
    expect(container.firstChild).not.toBeNull();
  });

  it('exposes role="status" for loading state accessibility', () => {
    render(<PageLoader />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('has an accessible label on the status element', () => {
    render(<PageLoader />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-label')).toBeTruthy();
  });
});
