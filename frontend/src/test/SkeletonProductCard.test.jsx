import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import SkeletonProductCard from '../components/SkeletonProductCard';

describe('SkeletonProductCard (#1184)', () => {
  it('mounts without error', () => {
    const { container } = render(<SkeletonProductCard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('is hidden from assistive technology via aria-hidden', () => {
    const { container } = render(<SkeletonProductCard />);
    expect(container.firstChild.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders multiple shimmer blocks (image, title, price, button areas)', () => {
    const { container } = render(<SkeletonProductCard />);
    // The card contains many shimmer divs — at least 7 (image + badge + name + 2 desc + price + qty)
    const divs = container.querySelectorAll('div');
    expect(divs.length).toBeGreaterThan(6);
  });
});
