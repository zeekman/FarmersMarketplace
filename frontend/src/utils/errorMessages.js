/**
 * Central error message mapper.
 * Translates raw backend/network error strings into human-friendly,
 * actionable messages grouped by domain.
 */

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
 * Returns a human-friendly error message for any error thrown by the API.
 * Falls back to the original message if no pattern matches.
 *
 * @param {Error|unknown} err
 * @returns {string}
 */
export function getErrorMessage(err) {
  const raw = err?.message || String(err || '');
  for (const { match, message } of ERROR_MAP) {
    if (match.test(raw)) return message;
  }
  return raw || 'An unexpected error occurred. Please try again.';
}

// Keep backward-compat alias for existing Stellar-specific usages
export { getErrorMessage as getStellarErrorMessage };
