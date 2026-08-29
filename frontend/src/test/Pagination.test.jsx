import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Pagination from '../components/Pagination';

describe('#1033 Pagination buildPageList clamping', () => {
  it('clamps current=8 when totalPages=3 and does not render an invalid page-8 button', () => {
    const onChange = vi.fn();
    render(
      <Pagination
        page={8}
        totalPages={3}
        total={30}
        limit={10}
        onChange={onChange}
      />,
    );

    // Should NOT have a page-8 button
    expect(screen.queryByLabelText('Page 8')).toBeNull();

    // Should have a page-3 button marked as current instead
    const page3btn = screen.getByLabelText('Page 3');
    expect(page3btn).toBeTruthy();
    expect(page3btn.getAttribute('aria-current')).toBe('page');
  });

  it('clamps current=0 to page 1 when totalPages>=1', () => {
    const onChange = vi.fn();
    render(
      <Pagination
        page={0}
        totalPages={5}
        total={50}
        limit={10}
        onChange={onChange}
      />,
    );

    // Page 1 is rendered and marked current
    const page1btn = screen.getByLabelText('Page 1');
    expect(page1btn).toBeTruthy();
    expect(page1btn.getAttribute('aria-current')).toBe('page');

    // Page 0 is not rendered
    expect(screen.queryByLabelText('Page 0')).toBeNull();
  });

  it('does not render any buttons when totalPages <= 1', () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        total={5}
        limit={10}
        onChange={vi.fn()}
      />,
    );

    // aria-label for prev/next/page buttons should not exist
    expect(screen.queryByLabelText('Previous page')).toBeNull();
    expect(screen.queryByLabelText('Next page')).toBeNull();
    expect(screen.queryByLabelText('Page 1')).toBeNull();
  });

  it('prev button navigates from clamped safePage (3) not stale page (8)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        page={8}
        totalPages={3}
        total={30}
        limit={10}
        onChange={onChange}
      />,
    );

    // Prev button is NOT disabled because safePage=3 (clamped) > 1
    const prevBtn = screen.getByLabelText('Previous page');
    expect(prevBtn).not.toBeDisabled();

    // Clicking Prev goes to safePage-1 = 2, not 7
    await user.click(prevBtn);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clicking a valid page calls onChange with that page number', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Pagination
        page={3}
        totalPages={5}
        total={50}
        limit={10}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('Page 4'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('renders correct button set for large page range with ellipsis', () => {
    render(
      <Pagination
        page={10}
        totalPages={20}
        total={200}
        limit={10}
        onChange={vi.fn()}
      />,
    );

    // Buttons around page 10 should exist (8,9,10,11,12)
    expect(screen.getByLabelText('Page 8')).toBeTruthy();
    expect(screen.getByLabelText('Page 9')).toBeTruthy();
    expect(screen.getByLabelText('Page 10')).toBeTruthy();
    expect(screen.getByLabelText('Page 11')).toBeTruthy();
    expect(screen.getByLabelText('Page 12')).toBeTruthy();
    // First and last page buttons
    expect(screen.getByLabelText('Page 1')).toBeTruthy();
    expect(screen.getByLabelText('Page 20')).toBeTruthy();
  });

  it('buildPageList returns correct range for small totalPages (≤7)', () => {
    render(
      <Pagination
        page={3}
        totalPages={5}
        total={25}
        limit={5}
        onChange={vi.fn()}
      />,
    );

    // All 5 page buttons rendered directly (no ellipsis)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByLabelText(`Page ${i}`)).toBeTruthy();
    }
  });
});
