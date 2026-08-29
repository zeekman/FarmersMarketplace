import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import StarRating from '../components/StarRating';

describe('StarRating (#1184)', () => {
  it('renders 5 stars by default', () => {
    const { container } = render(<StarRating value={3} />);
    const stars = container.querySelectorAll('span > span');
    expect(stars.length).toBe(5);
  });

  it('value=0 renders no filled stars', () => {
    const { container } = render(<StarRating value={0} />);
    const stars = [...container.querySelectorAll('span > span')];
    const filled = stars.filter(s => s.style.color !== 'rgb(221, 221, 221)' && s.style.color !== '#ddd');
    expect(filled.length).toBe(0);
  });

  it('value=5 renders all 5 filled stars', () => {
    const { container } = render(<StarRating value={5} />);
    const stars = [...container.querySelectorAll('span > span')];
    const colored = stars.filter(s => s.style.color === 'rgb(245, 166, 35)' || s.style.color === '#f5a623');
    expect(colored.length).toBe(5);
  });

  it('value=3.5 renders a half star at position 4', () => {
    const { container } = render(<StarRating value={3.5} />);
    const stars = [...container.querySelectorAll('span > span')];
    // star 4 (index 3) should be the half star
    const halfStar = stars[3];
    expect(halfStar.style.color).toBe('#f5a623');
  });

  it('value=4.9 lights up 4 full stars plus a half at position 5', () => {
    const { container } = render(<StarRating value={4.9} />);
    const stars = [...container.querySelectorAll('span > span')];
    const colored = stars.filter(s => s.style.color === 'rgb(245, 166, 35)' || s.style.color === '#f5a623');
    expect(colored.length).toBe(5);
  });

  it('shows "No reviews" when count=0', () => {
    render(<StarRating value={0} count={0} />);
    expect(screen.getByText(/No reviews/i)).toBeTruthy();
  });

  it('shows formatted score and count when count>0', () => {
    render(<StarRating value={4.2} count={17} />);
    expect(screen.getByText(/4\.2.*17/)).toBeTruthy();
  });

  it('calls onChange with the clicked star value (interactive mode)', () => {
    const onChange = vi.fn();
    const { container } = render(<StarRating value={2} onChange={onChange} />);
    const stars = container.querySelectorAll('span > span');
    fireEvent.click(stars[4]); // click 5th star
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('does not crash with value=0 and no count prop', () => {
    const { container } = render(<StarRating value={0} />);
    expect(container.firstChild).not.toBeNull();
  });
});
