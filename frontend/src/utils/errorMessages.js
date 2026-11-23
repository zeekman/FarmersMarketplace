/**
 * Central error message mapper.
 * Translates raw backend/network error strings into human-friendly,
 * actionable messages grouped by domain.
 */

import i18n from 'i18next';
import { captureException } from './sentry';

export const EN_API_ERRORS = {
  generic: 'An unexpected error occurred. Please try again.',
  insufficient_stock: "This product doesn't have enough stock for your order.",
  invalid_coupon: 'That coupon code is not valid.',
  coupon_expired: 'That coupon has expired.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  rate_limited_retry: 'Too many requests. Please try again in {{seconds}} seconds.',
  op_underfunded: 'Insufficient XLM balance for this transaction.',
  token_reused: 'Your session is no longer valid. Please log in again.',
  validation_error: 'Some fields are invalid. Please check the form and try again.',
  invalid_credentials: 'Incorrect email or password. Please try again.',
  invalid_destination: 'Invalid destination address. Please double-check the Stellar address.',
  invalid_code: 'That verification code is incorrect.',
  totp_required: 'Enter your two-factor authentication code to continue.',
  not_found: "We couldn't find what you were looking for.",
  escrow_timeout_not_reached: 'You cannot request a refund yet. Please wait until the escrow timeout has passed.',
  escrow_refund_after: 'You can request a refund after {{date}}.',
  escrow_in_dispute: 'This order is in dispute and cannot be settled until the dispute is resolved.',
  escrow_not_yet_releasable: 'This payment cannot be released yet. Please try again once delivery is confirmed.',
  escrow_submission_window_closed: 'The window to submit this order has closed.',
  escrow_already_settled: 'This payment has already been settled.',
};

const CODE_FALLBACKS = EN_API_ERRORS;

const ERROR_MAP = [
  // --- Auth ---
  { match: /invalid credentials|invalid email or password|wrong password/i,
    message: 'Incorrect email or password. Please try again.' },
  { match: /email.*already.*use|duplicate.*email|user.*already.*exists/i,
    message: 'An account with this email already exists. Try logging in instead.' },
  { match: /email.*not.*found|no.*account.*email/i,
    message: 'No account found with that email address.' },
  { match: /password.*weak|password.*too short/i,
    message: 'Password is too weak. Use at least 8 characters with uppercase, lowercase, and a number.' },
  { match: /account.*deactivated|user.*deactivated|account.*disabled/i,
    message: 'Your account has been deactivated. Please contact support.' },
  { match: /session expired|token.*expired|jwt expired/i,
    message: 'Your session has expired. Please log in again.' },
  { match: /not authenticated|unauthorized|please log in/i,
    message: 'You need to be logged in to do that.' },
  { match: /forbidden|not allowed|access denied/i,
    message: 'You don\'t have permission to do that.' },

  // --- Wallet / Stellar ---
  { match: /insufficient balance|insufficient funds/i,
    message: 'Insufficient XLM balance. Please fund your wallet and try again.' },
  { match: /no account|account not found|account.*does not exist/i,
    message: 'Stellar account not found. Fund your wallet to activate it.' },
  { match: /friendbot/i,
    message: 'Testnet faucet (Friendbot) is unavailable right now. Try again in a moment.' },
  { match: /transaction failed|tx.*failed/i,
    message: 'The Stellar transaction failed. Check your balance and try again.' },
  { match: /invalid.*destination|destination.*invalid/i,
    message: 'Invalid destination address. Please double-check the Stellar public key.' },
  { match: /below.*minimum|min.*balance|reserve/i,
    message: 'This transaction would drop your balance below the minimum reserve (1 XLM). Send a smaller amount.' },
  { match: /memo.*too long|memo.*invalid/i,
    message: 'Memo is too long or contains invalid characters (max 28 characters).' },
  { match: /bad_auth/i,
    message: 'Stellar authorization failed. Please log in again.' },

  // --- Orders ---
  { match: /out of stock|insufficient.*quantity|not enough.*stock/i,
    message: 'This product is out of stock or doesn\'t have enough quantity for your order.' },
  { match: /product.*not found|no.*product/i,
    message: 'This product no longer exists or has been removed.' },
  { match: /farmer.*cannot.*order|farmers.*not.*place/i,
    message: 'Farmers cannot place orders. Switch to a buyer account.' },
  { match: /order.*not found/i,
    message: 'Order not found. It may have been removed.' },
  { match: /already.*reviewed|review.*already/i,
    message: 'You\'ve already submitted a review for this order.' },
  { match: /must.*purchase|only.*buyers.*who.*purchased/i,
    message: 'You can only review products you\'ve purchased.' },

  // --- Products ---
  { match: /price.*invalid|invalid.*price/i,
    message: 'Invalid price. Please enter a positive number.' },
  { match: /quantity.*invalid|invalid.*quantity/i,
    message: 'Invalid quantity. Please enter a positive whole number.' },
  { match: /product.*name.*required|name.*required/i,
    message: 'Product name is required.' },
  { match: /image.*too large|file.*too large/i,
    message: 'Image is too large. Please upload a file under 5 MB.' },
  { match: /invalid.*file.*type|unsupported.*image/i,
    message: 'Unsupported file type. Please upload a JPEG, PNG, or WebP image.' },

  // --- Network / Server ---
  { match: /rate limit|too many requests/i,
    message: 'Too many requests. Please wait a moment and try again.' },
  { match: /timeout|timed out/i,
    message: 'The request timed out. Check your connection and try again.' },
  { match: /failed to fetch|networkerror|network.*error|load failed/i,
    message: 'Unable to reach the server. Check your internet connection and try again.' },
  { match: /internal server error|500/i,
    message: 'Something went wrong on our end. Please try again in a moment.' },
  { match: /service.*unavailable|503/i,
    message: 'The service is temporarily unavailable. Please try again shortly.' },
  { match: /bad request|400/i,
    message: 'The request was invalid. Please check your input and try again.' },
];

/**
 * Stable backend error codes (BE-23) → i18n keys under `apiErrors`.
 * Codes are matched before any message pattern.
 */
export const CODE_TO_I18N_KEY = {
  insufficient_stock: 'apiErrors.insufficient_stock',
  invalid_coupon: 'apiErrors.invalid_coupon',
  coupon_expired: 'apiErrors.coupon_expired',
  rate_limited: 'apiErrors.rate_limited',
  op_underfunded: 'apiErrors.op_underfunded',
  insufficient_balance: 'apiErrors.op_underfunded',
  token_reused: 'apiErrors.token_reused',
  validation_error: 'apiErrors.validation_error',
  invalid_credentials: 'apiErrors.invalid_credentials',
  invalid_destination: 'apiErrors.invalid_destination',
  invalid_code: 'apiErrors.invalid_code',
  totp_required: 'apiErrors.totp_required',
  not_found: 'apiErrors.not_found',
  escrow_timeout_not_reached: 'apiErrors.escrow_timeout_not_reached',
  escrow_in_dispute: 'apiErrors.escrow_in_dispute',
  escrow_not_yet_releasable: 'apiErrors.escrow_not_yet_releasable',
  escrow_submission_window_closed: 'apiErrors.escrow_submission_window_closed',
  escrow_already_settled: 'apiErrors.escrow_already_settled',
};

const GENERIC_KEY = 'apiErrors.generic';
const GENERIC_FALLBACK = 'An unexpected error occurred. Please try again.';

function translate(key, fallback, options) {
  try {
    if (i18n?.isInitialized) {
      const out = i18n.t(key, { defaultValue: fallback, ...options });
      if (out && out !== key) return out;
    }
  } catch { /* i18n unavailable (e.g. tests) */ }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => options?.[k] ?? '');
}

/** Seconds until the rate limit resets, read from the RateLimit-Reset header. */
export function getRetryAfterSeconds(err) {
  const n = Number(err?.retryAfter);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/**
 * Field-level validation errors from a `validation_error` response, as
 * `{ fieldName: message }`. Accepts both `[{ field, message }]` and
 * `{ field: message }` shapes.
 */
export function getFieldErrors(err) {
  const details = err?.details;
  if (!details) return {};
  if (Array.isArray(details)) {
    return details.reduce((acc, d) => {
      const field = d?.field ?? (Array.isArray(d?.path) ? d.path.join('.') : d?.path);
      if (field && !acc[field]) acc[field] = d.message || String(d);
      return acc;
    }, {});
  }
  if (typeof details === 'object') return { ...details };
  return {};
}

/**
 * Formats `retry_after` (ISO string, or Unix seconds/ms) in the user's locale and
 * timezone. Returns null when the value is missing or unparseable.
 */
function formatRetryDate(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(i18n?.language || undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(ms));
}

/**
 * Returns a human-friendly error message for any error thrown by the API.
 * Maps by `err.code` first, then by known message patterns, and otherwise
 * falls back to a generic message so server internals are never shown.
 *
 * @param {Error|unknown} err
 * @returns {string}
 */
export function getErrorMessage(err) {
  const code = err?.code;
  if (code === 'escrow_timeout_not_reached') {
    const date = formatRetryDate(err.retry_after ?? err.details?.retry_after);
    if (date) return translate('apiErrors.escrow_refund_after', EN_API_ERRORS.escrow_refund_after, { date });
  }
  if (code && CODE_TO_I18N_KEY[code]) {
    const key = CODE_TO_I18N_KEY[code];
    if (code === 'rate_limited') {
      const seconds = getRetryAfterSeconds(err);
      if (seconds) {
        return translate('apiErrors.rate_limited_retry', `Too many requests. Please try again in ${seconds} seconds.`, { seconds });
      }
    }
    return translate(key, CODE_FALLBACKS[code] || GENERIC_FALLBACK);
  }
  if (typeof code === 'string' && code.startsWith('escrow_')) {
    captureException(new Error(`Unmapped escrow error code: ${code}`), { extra: { code } });
    return translate(GENERIC_KEY, GENERIC_FALLBACK);
  }
  const raw = err?.message || String(err || '');
  for (const { match, message } of ERROR_MAP) {
    if (match.test(raw)) return message;
  }
  return translate(GENERIC_KEY, GENERIC_FALLBACK);
}

// Keep backward-compat alias for existing Stellar-specific usages
export { getErrorMessage as getStellarErrorMessage };
