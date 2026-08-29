import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FlashSaleManager from '../../components/dashboard/FlashSaleManager';
import { api } from '../../api/client';

jest.mock('../../api/client', () => ({
  api: {
    setFlashSale: jest.fn(),
    cancelFlashSale: jest.fn(),
  },
}));

const PRODUCTS = [
  { id: 1, name: 'Apples', flash_sale_price: 2.5, flash_sale_ends_at: new Date(Date.now() + 3600000).toISOString() },
  { id: 2, name: 'Oranges', flash_sale_price: null, flash_sale_ends_at: null },
];

function futureDateTime() {
  // Returns a datetime-local string 1 hour from now
  const d = new Date(Date.now() + 3600000);
  // datetime-local format: YYYY-MM-DDTHH:mm
  return d.toISOString().slice(0, 16);
}

function pastDateTime() {
  const d = new Date(Date.now() - 3600000);
  return d.toISOString().slice(0, 16);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── #1031 — Cancel confirmation dialog ───────────────────────────────────────

describe('FlashSaleManager — cancel confirmation (#1031)', () => {
  it('does not call api.cancelFlashSale immediately on cancel click', () => {
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(api.cancelFlashSale).not.toHaveBeenCalled();
  });

  it('shows a confirmation dialog mentioning the product name after cancel click', () => {
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/apples/i)).toBeInTheDocument();
  });

  it('calls api.cancelFlashSale after confirming in the dialog', async () => {
    api.cancelFlashSale.mockResolvedValue({});
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /yes, cancel sale/i }));
    });
    expect(api.cancelFlashSale).toHaveBeenCalledWith(1);
  });

  it('does NOT call api.cancelFlashSale if the user dismisses the confirmation', async () => {
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep sale/i }));
    expect(api.cancelFlashSale).not.toHaveBeenCalled();
    // Dialog should be gone
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ── #1032 — Future date validation ───────────────────────────────────────────

describe('FlashSaleManager — future date validation (#1032)', () => {
  function fillForm(endsAt) {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1.5' } });
    // datetime-local input has no accessible role; query by label text
    const endsAtInput = screen.getByLabelText(/ends at/i);
    fireEvent.change(endsAtInput, { target: { value: endsAt } });
  }

  it('does not call api.setFlashSale and shows an error for a past end time', async () => {
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fillForm(pastDateTime());
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /set flash sale/i }).closest('form'));
    });
    expect(api.setFlashSale).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/future/i);
  });

  it('calls api.setFlashSale when end time is in the future', async () => {
    api.setFlashSale.mockResolvedValue({ data: { id: 2 } });
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fillForm(futureDateTime());
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /set flash sale/i }).closest('form'));
    });
    expect(api.setFlashSale).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/flash sale set/i);
  });

  it('clears the error message when the user corrects the end time', async () => {
    render(<FlashSaleManager products={PRODUCTS} onChanged={jest.fn()} />);
    fillForm(pastDateTime());
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /set flash sale/i }).closest('form'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Now update to a future time — error should clear
    const endsAtInput = screen.getByLabelText(/ends at/i);
    fireEvent.change(endsAtInput, { target: { value: futureDateTime() } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
