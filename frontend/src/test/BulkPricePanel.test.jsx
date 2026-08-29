import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api/client', () => ({
  api: {
    bulkUpdatePrices: vi.fn(),
  },
}));

import BulkPricePanel from '../../components/dashboard/BulkPricePanel';
import { api } from '../../api/client';

const PRODUCTS = [
  { id: 1, name: 'Tomatoes', price: 5 },
  { id: 2, name: 'Honey', price: 12 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('BulkPricePanel — validation', () => {
  it('shows an error and does not call the API when neither a % nor individual prices are entered', async () => {
    render(<BulkPricePanel products={PRODUCTS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });
    expect(api.bulkUpdatePrices).not.toHaveBeenCalled();
    expect(screen.getByText(/percentage adjustment or individual prices/i)).toBeInTheDocument();
  });
});

// ── Percentage adjustment path ────────────────────────────────────────────────

describe('BulkPricePanel — percentage adjustment', () => {
  it('calls api.bulkUpdatePrices with adjustment_percent when % field is filled', async () => {
    api.bulkUpdatePrices.mockResolvedValue({ data: { updated: 2 } });
    render(<BulkPricePanel products={PRODUCTS} onUpdated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+10/i), { target: { value: '10' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });

    expect(api.bulkUpdatePrices).toHaveBeenCalledTimes(1);
    const [, pct] = api.bulkUpdatePrices.mock.calls[0];
    expect(pct).toBe(10);
  });

  it('disables individual price inputs while a % adjustment is entered', () => {
    render(<BulkPricePanel products={PRODUCTS} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+10/i), { target: { value: '5' } });
    const priceInputs = screen.getAllByPlaceholderText('—');
    priceInputs.forEach((input) => expect(input).toBeDisabled());
  });

  it('shows a success message with the updated count', async () => {
    api.bulkUpdatePrices.mockResolvedValue({ data: { updated: 2 } });
    render(<BulkPricePanel products={PRODUCTS} />);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+10/i), { target: { value: '10' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });

    expect(screen.getByText(/updated 2 product/i)).toBeInTheDocument();
  });

  it('resets the % field after a successful update', async () => {
    api.bulkUpdatePrices.mockResolvedValue({ data: { updated: 2 } });
    render(<BulkPricePanel products={PRODUCTS} />);

    const pctInput = screen.getByPlaceholderText(/e\.g\. \+10/i);
    fireEvent.change(pctInput, { target: { value: '10' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });

    expect(pctInput).toHaveValue(null);
  });
});

// ── Individual price path ─────────────────────────────────────────────────────

describe('BulkPricePanel — individual price updates', () => {
  it('calls api.bulkUpdatePrices with the entered per-product prices', async () => {
    api.bulkUpdatePrices.mockResolvedValue({ data: { updated: 1 } });
    render(<BulkPricePanel products={PRODUCTS} onUpdated={vi.fn()} />);

    // Set a new price only for product id=1
    const [firstPriceInput] = screen.getAllByPlaceholderText('—');
    fireEvent.change(firstPriceInput, { target: { value: '7.5' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });

    expect(api.bulkUpdatePrices).toHaveBeenCalledTimes(1);
    const [updates] = api.bulkUpdatePrices.mock.calls[0];
    expect(updates).toEqual([{ product_id: 1, price: 7.5 }]);
  });

  it('calls the onUpdated callback after a successful update', async () => {
    const onUpdated = vi.fn();
    api.bulkUpdatePrices.mockResolvedValue({ data: { updated: 1 } });
    render(<BulkPricePanel products={PRODUCTS} onUpdated={onUpdated} />);

    const [firstPriceInput] = screen.getAllByPlaceholderText('—');
    fireEvent.change(firstPriceInput, { target: { value: '9' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });

    expect(onUpdated).toHaveBeenCalledTimes(1);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('BulkPricePanel — error handling', () => {
  it('shows an error message when api.bulkUpdatePrices rejects', async () => {
    api.bulkUpdatePrices.mockRejectedValue(new Error('Network failure'));
    render(<BulkPricePanel products={PRODUCTS} />);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+10/i), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply price update/i }));
    });

    expect(screen.getByText(/network failure/i)).toBeInTheDocument();
  });
});
