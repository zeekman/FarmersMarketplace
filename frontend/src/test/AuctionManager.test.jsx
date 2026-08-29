import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api/client', () => ({
  api: {
    createAuction: vi.fn(),
  },
}));

import AuctionManager from '../../components/dashboard/AuctionManager';
import { api } from '../../api/client';

const PRODUCTS = [
  { id: 1, name: 'Heirloom Tomatoes' },
  { id: 2, name: 'Raw Honey' },
];

/** Returns a datetime-local string offset by `offsetMs` milliseconds from now. */
function datetimeLocal(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 16);
}

function futureDateTime() {
  return datetimeLocal(2 * 3600 * 1000); // 2 hours from now
}

function pastDateTime() {
  return datetimeLocal(-3600 * 1000); // 1 hour ago
}

/** Fill the required fields of the auction form. */
function fillForm({ startPrice = '5.00', reservePrice = '', endsAt = futureDateTime() } = {}) {
  fireEvent.change(screen.getByLabelText(/product/i), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText(/starting price/i), { target: { value: startPrice } });
  if (reservePrice !== '') {
    fireEvent.change(screen.getByLabelText(/reserve price/i), { target: { value: reservePrice } });
  }
  fireEvent.change(screen.getByLabelText(/ends at/i), { target: { value: endsAt } });
}

/** Submit the form by clicking the submit button. */
async function submitForm() {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: /create auction/i }).closest('form'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── End-time validation ───────────────────────────────────────────────────────

describe('AuctionManager — end-time validation', () => {
  it('rejects a past end time and does not call api.createAuction', async () => {
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ endsAt: pastDateTime() });

    await submitForm();

    expect(api.createAuction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/future/i);
  });

  it('shows an error alert (not a success message) for a past end time', async () => {
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ endsAt: pastDateTime() });

    await submitForm();

    const alert = screen.getByRole('alert');
    // Success text must not appear
    expect(alert.textContent).not.toMatch(/auction created/i);
  });

  it('accepts a future end time and proceeds to call the API', async () => {
    api.createAuction.mockResolvedValue({ id: 42 });
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ endsAt: futureDateTime() });

    await submitForm();

    expect(api.createAuction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ── Reserve price vs. starting price validation ───────────────────────────────

describe('AuctionManager — reserve price validation', () => {
  it('rejects a reserve price below the starting price', async () => {
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ startPrice: '10.00', reservePrice: '5.00' });

    await submitForm();

    expect(api.createAuction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/reserve price/i);
  });

  it('accepts a reserve price equal to the starting price', async () => {
    api.createAuction.mockResolvedValue({ id: 43 });
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ startPrice: '8.00', reservePrice: '8.00' });

    await submitForm();

    expect(api.createAuction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('accepts a reserve price above the starting price', async () => {
    api.createAuction.mockResolvedValue({ id: 44 });
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ startPrice: '5.00', reservePrice: '12.00' });

    await submitForm();

    expect(api.createAuction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('omits reserve_price from payload when the field is left blank', async () => {
    api.createAuction.mockResolvedValue({ id: 45 });
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ startPrice: '5.00', reservePrice: '' });

    await submitForm();

    expect(api.createAuction).toHaveBeenCalledTimes(1);
    const payload = api.createAuction.mock.calls[0][0];
    expect(payload).not.toHaveProperty('reserve_price');
  });
});

// ── Successful creation ───────────────────────────────────────────────────────

describe('AuctionManager — successful creation', () => {
  it('calls api.createAuction with the correct payload shape', async () => {
    api.createAuction.mockResolvedValue({ id: 1 });
    render(<AuctionManager products={PRODUCTS} />);

    const endsAt = futureDateTime();
    fillForm({ startPrice: '5.00', reservePrice: '10.00', endsAt });

    await submitForm();

    expect(api.createAuction).toHaveBeenCalledTimes(1);
    const payload = api.createAuction.mock.calls[0][0];

    expect(payload.product_id).toBe(1);
    expect(payload.start_price).toBe(5);
    expect(payload.reserve_price).toBe(10);
    // ends_at must be a valid ISO 8601 string representing the chosen time
    expect(() => new Date(payload.ends_at)).not.toThrow();
    expect(new Date(payload.ends_at).toISOString()).toBe(payload.ends_at);
  });

  it('shows a success message after creation', async () => {
    api.createAuction.mockResolvedValue({ id: 1 });
    render(<AuctionManager products={PRODUCTS} />);
    fillForm();

    await submitForm();

    expect(screen.getByRole('alert').textContent).toMatch(/auction created/i);
  });

  it('resets the form fields after a successful creation', async () => {
    api.createAuction.mockResolvedValue({ id: 1 });
    render(<AuctionManager products={PRODUCTS} />);
    fillForm({ startPrice: '7.50', reservePrice: '15.00' });

    await submitForm();

    expect(screen.getByLabelText(/starting price/i)).toHaveValue(null);
    expect(screen.getByLabelText(/reserve price/i)).toHaveValue(null);
    expect(screen.getByLabelText(/ends at/i)).toHaveValue('');
  });

  it('shows an error alert when api.createAuction rejects', async () => {
    api.createAuction.mockRejectedValue(new Error('Server error'));
    render(<AuctionManager products={PRODUCTS} />);
    fillForm();

    await submitForm();

    expect(screen.getByRole('alert').textContent).toMatch(/server error/i);
  });
});
