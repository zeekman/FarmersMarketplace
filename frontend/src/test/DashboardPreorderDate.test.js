import { describe, it, expect } from 'vitest';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validatePreorderDate(is_preorder, preorder_delivery_date) {
  if (!is_preorder) return null;
  if (!preorder_delivery_date) return 'Date must be in YYYY-MM-DD format';
  if (!DATE_RE.test(preorder_delivery_date)) return 'Date must be in YYYY-MM-DD format';
  return null;
}

describe('Dashboard preorder_delivery_date validation (#421)', () => {
  it('returns no error when is_preorder is false', () => {
    expect(validatePreorderDate(false, '')).toBeNull();
    expect(validatePreorderDate(false, 'bad-date')).toBeNull();
  });

  it('returns error when is_preorder is true and date is missing', () => {
    expect(validatePreorderDate(true, '')).toBe('Date must be in YYYY-MM-DD format');
  });

  it('returns error for invalid format (MM/DD/YYYY)', () => {
    expect(validatePreorderDate(true, '12/31/2026')).toBe('Date must be in YYYY-MM-DD format');
  });

  it('returns error for partial date', () => {
    expect(validatePreorderDate(true, '2026-12')).toBe('Date must be in YYYY-MM-DD format');
  });

  it('returns null for a valid YYYY-MM-DD date', () => {
    expect(validatePreorderDate(true, '2026-12-31')).toBeNull();
  });

  it('returns null for another valid date', () => {
    expect(validatePreorderDate(true, '2027-01-01')).toBeNull();
  });
});
