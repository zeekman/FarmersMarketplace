import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import BundleDiscountPanel from '../../components/dashboard/BundleDiscountPanel';

const TIERS = [
  { id: 1, min_products: 3, discount_percent: 10 },
  { id: 2, min_products: 5, discount_percent: 20 },
];

// ── Empty state ───────────────────────────────────────────────────────────────

describe('BundleDiscountPanel — empty state', () => {
  it('shows "No discount tiers configured" when bundleDiscounts is empty', () => {
    render(
      <BundleDiscountPanel
        bundleDiscounts={[]}
        bdForm={{ min_products: '', discount_percent: '' }}
        onFormChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/no discount tiers configured/i)).toBeInTheDocument();
  });
});

// ── Tier list ─────────────────────────────────────────────────────────────────

describe('BundleDiscountPanel — tier list', () => {
  it('renders each tier with its min_products and discount_percent', () => {
    render(
      <BundleDiscountPanel
        bundleDiscounts={TIERS}
        bdForm={{ min_products: '', discount_percent: '' }}
        onFormChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/3\+ products/i)).toBeInTheDocument();
    expect(screen.getByText(/10% off/i)).toBeInTheDocument();
    expect(screen.getByText(/5\+ products/i)).toBeInTheDocument();
    expect(screen.getByText(/20% off/i)).toBeInTheDocument();
  });

  it('renders a Delete button for each tier', () => {
    render(
      <BundleDiscountPanel
        bundleDiscounts={TIERS}
        bdForm={{ min_products: '', discount_percent: '' }}
        onFormChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(2);
  });
});

// ── Form interaction ──────────────────────────────────────────────────────────

describe('BundleDiscountPanel — form interaction', () => {
  it('calls onFormChange with "min_products" when that field changes', () => {
    const onFormChange = vi.fn();
    render(
      <BundleDiscountPanel
        bundleDiscounts={[]}
        bdForm={{ min_products: '', discount_percent: '' }}
        onFormChange={onFormChange}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 3/i), { target: { value: '4' } });
    expect(onFormChange).toHaveBeenCalledWith('min_products', '4');
  });

  it('calls onFormChange with "discount_percent" when that field changes', () => {
    const onFormChange = vi.fn();
    render(
      <BundleDiscountPanel
        bundleDiscounts={[]}
        bdForm={{ min_products: '', discount_percent: '' }}
        onFormChange={onFormChange}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 10/i), { target: { value: '15' } });
    expect(onFormChange).toHaveBeenCalledWith('discount_percent', '15');
  });

  it('calls onSubmit when the Add Tier button is clicked', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <BundleDiscountPanel
        bundleDiscounts={[]}
        bdForm={{ min_products: '3', discount_percent: '10' }}
        onFormChange={vi.fn()}
        onSubmit={onSubmit}
        onDelete={vi.fn()}
      />
    );
    fireEvent.submit(screen.getByRole('button', { name: /add tier/i }).closest('form'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete with the tier id when Delete is clicked', () => {
    const onDelete = vi.fn();
    render(
      <BundleDiscountPanel
        bundleDiscounts={TIERS}
        bdForm={{ min_products: '', discount_percent: '' }}
        onFormChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={onDelete}
      />
    );
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});

// ── Feedback message ──────────────────────────────────────────────────────────

describe('BundleDiscountPanel — feedback message', () => {
  it('displays a success message when bdMsg.type is "ok"', () => {
    render(
      <BundleDiscountPanel
        bundleDiscounts={[]}
        bdForm={{ min_products: '', discount_percent: '' }}
        bdMsg={{ type: 'ok', text: 'Tier added!' }}
        onFormChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Tier added!')).toBeInTheDocument();
  });

  it('displays an error message when bdMsg.type is "error"', () => {
    render(
      <BundleDiscountPanel
        bundleDiscounts={[]}
        bdForm={{ min_products: '', discount_percent: '' }}
        bdMsg={{ type: 'error', text: 'Something went wrong.' }}
        onFormChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});
