const STELLAR_ERROR_MAP = [
  {
    match: /insufficient balance/i,
    message: 'Insufficient XLM balance. Please fund your wallet first.',
  },
  {
    match: /no account|account not found/i,
    message: 'Stellar account not found. Please fund your wallet to activate it.',
  },
  {
    match: /friendbot/i,
    message: 'Testnet faucet (Friendbot) is unavailable. Please try again later.',
  },
  {
    match: /transaction failed/i,
    message: 'Stellar transaction failed. Please check your balance and try again.',
  },
  {
    match: /timeout|timed out/i,
    message: 'The Stellar network request timed out. Please try again.',
  },
  {
    match: /failed to fetch|networkerror|network/i,
    message: 'Unable to reach the Stellar network. Check your connection and try again.',
  },
  {
    match: /rate limit|too many requests/i,
    message: 'Too many requests to the Stellar network. Please wait a moment and retry.',
  },
  {
    match: /bad_auth|unauthorized/i,
    message: 'Stellar authorization failed. Please log in again.',
  },
];

export function getStellarErrorMessage(err) {
  const raw = err?.message || String(err);
  for (const { match, message } of STELLAR_ERROR_MAP) {
    if (match.test(raw)) return message;
  }
  return err?.message || 'An unexpected error occurred. Please try again.';
}
