import React from 'react';
import { render, screen } from '@testing-library/react';
import SkeletonProductCard from '../../components/SkeletonProductCard';

const PAGE_SIZE = 20;

describe('SkeletonProductCard', () => {
  it('renders without crashing', () => {
    const { container } = render(<SkeletonProductCard />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('is aria-hidden so screen readers skip it', () => {
    const { container } = render(<SkeletonProductCard />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('shimmer style tag is injected into document head only once for multiple cards', () => {
    render(
      <>
        {Array.from({ length: PAGE_SIZE }).map((_, i) => (
          <SkeletonProductCard key={i} />
        ))}
      </>
    );
    const styleEls = document.querySelectorAll('#skeleton-shimmer-style');
    expect(styleEls).toHaveLength(1);
  });

  it(`renders exactly PAGE_SIZE (${PAGE_SIZE}) skeletons in a grid`, () => {
    const { container } = render(
      <div role="grid">
        {Array.from({ length: PAGE_SIZE }).map((_, i) => (
          <SkeletonProductCard key={i} />
        ))}
      </div>
    );
    const cards = container.querySelectorAll('[aria-hidden="true"]');
    expect(cards).toHaveLength(PAGE_SIZE);
  });

  it('card has the same outer dimensions as a real product card (min-height via padding)', () => {
    const { container } = render(<SkeletonProductCard />);
    const card = container.firstChild;
    // Verify structural shape matches real card
    expect(card.style.borderRadius).toBe('12px');
    expect(card.style.padding).toBe('20px');
  });

  it('shimmer keyframes are present in the injected style tag', () => {
    render(<SkeletonProductCard />);
    const styleEl = document.getElementById('skeleton-shimmer-style');
    expect(styleEl?.textContent).toMatch(/@keyframes shimmer/);
  });
});
