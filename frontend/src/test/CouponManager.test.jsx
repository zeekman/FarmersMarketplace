import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      ...actual.api,
      getMyCoupons: vi.fn(),
      createCoupon: vi.fn(),
      deleteCoupon: vi.fn(),
    },
  };
});

import CouponManager from '../../components/dashboard/CouponManager';
import { api } from '../../api/client';

const COUPONS = [
  { id: 1, code: 'SUMMER10', discount_type: 'percent', discount_value: 10, uses_count: 2, max_uses: 50, expires_at: null },
  { id: 2, code: 'FLAT5', discount_type: 'fixed', discount_value: 5, uses_count: 0, max_uses: null, expires_at: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return empty list on mount
  api.getMyCoupons.mockResolvedValue({ data: [] });
});

// ── Mount / load ──────────────────────────────────────────────────────────────

describe('CouponManager — initial load', () => {
  it('calls api.getMyCoupons on mount', async () => {
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalledTimes(1));
  });

  it('renders existing coupons returned from the API', async () => {
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });
    render(<CouponManager />);
    await waitFor(() => expect(screen.getByText('SUMMER10')).toBeInTheDocument());
    expect(screen.getByText('FLAT5')).toBeInTheDocument();
  });

  it('shows "No coupon codes yet" when the list is empty', async () => {
    render(<CouponManager />);
    await waitFor(() => expect(screen.getByText(/no coupon codes yet/i)).toBeInTheDocument());
  });
});

// ── Create coupon ─────────────────────────────────────────────────────────────

describe('CouponManager — create coupon', () => {
  async function fillAndSubmit({ code = 'SAVE20', value = '20' } = {}) {
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: code } });
    fireEvent.change(screen.getByLabelText(/^value/i), { target: { value } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /create coupon/i }).closest('form'));
    });
  }

  it('calls api.createCoupon with the correct payload', async () => {
    api.createCoupon.mockResolvedValue({});
    api.getMyCoupons.mockResolvedValue({ data: [] });
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit({ code: 'SAVE20', value: '20' });

    expect(api.createCoupon).toHaveBeenCalledTimes(1);
    const payload = api.createCoupon.mock.calls[0][0];
    expect(payload.code).toBe('SAVE20');
    expect(payload.discount_type).toBe('percent');
    expect(payload.discount_value).toBe(20);
  });

  it('uppercases the coupon code in the payload', async () => {
    api.createCoupon.mockResolvedValue({});
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit({ code: 'lowercase', value: '5' });

    const payload = api.createCoupon.mock.calls[0][0];
    expect(payload.code).toBe('LOWERCASE');
  });

  it('shows a success alert after creation', async () => {
    api.createCoupon.mockResolvedValue({});
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit();

    expect(screen.getByRole('alert').textContent).toMatch(/created successfully/i);
  });

  it('shows an error alert when api.createCoupon rejects', async () => {
    api.createCoupon.mockRejectedValue(new Error('Duplicate code'));
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit();

    expect(screen.getByRole('alert').textContent).toMatch(/duplicate code/i);
  });

  it('resets form fields after a successful creation', async () => {
    api.createCoupon.mockResolvedValue({});
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit({ code: 'RESET', value: '15' });

    expect(screen.getByLabelText(/^code/i)).toHaveValue('');
    expect(screen.getByLabelText(/^value/i)).toHaveValue(null);
  });

  it('sends null for max_uses when the field is left blank', async () => {
    api.createCoupon.mockResolvedValue({});
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit();

    const payload = api.createCoupon.mock.calls[0][0];
    expect(payload.max_uses).toBeNull();
  });

  it('sends null for expires_at when the field is left blank', async () => {
    api.createCoupon.mockResolvedValue({});
    render(<CouponManager />);
    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalled());

    await fillAndSubmit();

    const payload = api.createCoupon.mock.calls[0][0];
    expect(payload.expires_at).toBeNull();
  });
});

// ── Coupon list rendering ─────────────────────────────────────────────────────

describe('CouponManager — coupon list', () => {
  it('shows percent discount badge for percent-type coupons', async () => {
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });
    render(<CouponManager />);
    await waitFor(() => screen.getByText('SUMMER10'));
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('shows XLM discount badge for fixed-type coupons', async () => {
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });
    render(<CouponManager />);
    await waitFor(() => screen.getByText('FLAT5'));
    expect(screen.getByText('5 XLM')).toBeInTheDocument();
  });

  it('shows uses_count / max_uses for limited coupons', async () => {
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });
    render(<CouponManager />);
    await waitFor(() => screen.getByText('SUMMER10'));
    expect(screen.getByText('2 / 50')).toBeInTheDocument();
  });

  it('shows only uses_count when max_uses is null', async () => {
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });
    render(<CouponManager />);
    await waitFor(() => screen.getByText('FLAT5'));
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

// ── Delete coupon ─────────────────────────────────────────────────────────────

describe('CouponManager — delete coupon', () => {
  it('calls api.deleteCoupon with the correct id after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });
    api.deleteCoupon.mockResolvedValue({});

    render(<CouponManager />);
    await waitFor(() => screen.getByText('SUMMER10'));

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    expect(api.deleteCoupon).toHaveBeenCalledWith(1);
    vi.restoreAllMocks();
  });

  it('does NOT call api.deleteCoupon when the user cancels the confirm dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    api.getMyCoupons.mockResolvedValue({ data: COUPONS });

    render(<CouponManager />);
    await waitFor(() => screen.getByText('SUMMER10'));

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(api.deleteCoupon).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('reloads the coupon list after a successful delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.getMyCoupons
      .mockResolvedValueOnce({ data: COUPONS })
      .mockResolvedValueOnce({ data: [] });
    api.deleteCoupon.mockResolvedValue({});

    render(<CouponManager />);
    await waitFor(() => screen.getByText('SUMMER10'));

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => expect(api.getMyCoupons).toHaveBeenCalledTimes(2));
    vi.restoreAllMocks();
  });
});
