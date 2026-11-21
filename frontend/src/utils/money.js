// Money helpers for XLM <-> stroops and fiat formatting.
//
// `toStroops` is the single source of truth for validating user-entered XLM
// amounts. It rejects:
//   - negative values
//   - exponent notation (e.g. "1e3")
//   - more than 7 decimal places (XLM precision)
//   - non-numeric / empty input
// and returns the integer stroop amount (1 XLM = 10_000_000 stroops).

export const STROOPS_PER_XLM = 10_000_000;
export const XLM_DECIMALS = 7;

// Matches an optional sign, integer part, and up to 7 fractional digits.
// Deliberately excludes exponent notation and stray characters.
const XLM_AMOUNT_RE = /^-?\d+(?:\.\d{1,7})?$/;

/**
 * Validate a user-entered XLM amount and convert it to stroops.
 *
 * @param {string|number} value
 * @returns {{ ok: true, stroops: number, xlm: number } | { ok: false, error: string }}
 */
export function toStroops(value) {
  if (value === null || value === undefined) {
    return { ok: false, error: 'Enter an amount' };
  }

  const raw = String(value).trim();

  if (raw === '') {
    return { ok: false, error: 'Enter an amount' };
  }

  // Reject exponent notation explicitly so "1e3" gets a clear message.
  if (/[eE]/.test(raw)) {
    return { ok: false, error: 'Exponent notation is not allowed' };
  }

  if (!XLM_AMOUNT_RE.test(raw)) {
    // Distinguish too-many-decimals from other malformed input.
    if (/^-?\d+\.\d{8,}$/.test(raw)) {
      return { ok: false, error: `Use at most ${XLM_DECIMALS} decimal places` };
    }
    return { ok: false, error: 'Enter a valid amount' };
  }

  const xlm = Number(raw);

  if (!Number.isFinite(xlm)) {
    return { ok: false, error: 'Enter a valid amount' };
  }

  if (xlm < 0) {
    return { ok: false, error: 'Amount cannot be negative' };
  }

  // Round to avoid floating point drift when scaling to stroops.
  const stroops = Math.round(xlm * STROOPS_PER_XLM);

  return { ok: true, stroops, xlm };
}

/**
 * Format a fiat amount, e.g. formatFiat(123.45, 'KES') -> "KES 123.45".
 *
 * @param {number} amount
 * @param {string} [currency='KES']
 * @returns {string}
 */
export function formatFiat(amount, currency = 'KES') {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) {
    return '';
  }

  const formatted = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${currency} ${formatted}`;
}
