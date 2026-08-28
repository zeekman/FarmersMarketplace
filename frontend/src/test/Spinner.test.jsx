import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import Spinner from '../components/Spinner';

describe('Spinner (#1184)', () => {
  it('mounts without error', () => {
    const { container } = render(<Spinner />);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows the default "Loading..." message', () => {
    render(<Spinner />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('accepts a custom message prop', () => {
    render(<Spinner message="Please wait" />);
    expect(screen.getByText('Please wait')).toBeTruthy();
  });

  it('accepts a custom size prop without crashing', () => {
    const { container } = render(<Spinner size={60} />);
    expect(container.firstChild).not.toBeNull();
  });
});
