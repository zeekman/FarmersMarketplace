const STELLAR_ERROR_MAP = [
  { match: /insufficient balance/i, message: 'Insufficient XLM balance. Please fund your wallet first.' },
  { match: /no account|account not found/i, message: 'Stellar account not found. Please fund your wallet to activate it.' },
  { match: /friendbot/i, message: 'Testnet faucet (Friendbot) is unavailable. Please try again later.' },
  { match: /transaction failed/i, message: 'Stellar transaction failed. Please check your balance and try again.' },
  { match: /timeout|timed out/i, message: 'The Stellar network request timed out. Please try again.' },
  { match: /failed to fetch|networkerror|network/i, message: 'Unable to reach the Stellar network. Check your connection and try again.' },
  { match: /rate limit|too many requests/i, message: 'Too many requests to the Stellar network. Please wait a moment and retry.' },
  { match: /bad_auth|unauthorized/i, message: 'Stellar authorization failed. Please log in again.' },
];

const STELLAR_ERROR_CODE_MAP = {
  tx_bad_seq: 'Invalid transaction sequence number. Please try again.',
  tx_insufficient_fee: 'The transaction fee is insufficient. Please increase the fee and retry.',
  tx_no_account: 'The source account does not exist. Please fund your wallet first.',
  tx_failed: 'Transaction failed on the Stellar network. Please check your balance and try again.',
  op_underfunded: 'The account does not have enough funds to perform this operation.',
  op_src_not_authorized: 'The source account is not authorized to perform this operation.',
  op_no_destination: 'The destination account does not exist.',
  op_no_trust: 'The account does not have a trustline for this asset. Please add the trustline first.',
  op_low_reserve: 'The account does not have enough balance to maintain the minimum reserve. Please fund your account.',
  op_line_full: 'The trustline limit has been reached.',
};

export function getStellarErrorMessage(err) {
  const raw = (err?.message || String(err));
  const code = err?.code;
  
  // Special handling for unfunded account error
  if (code === 'unfunded_account') {
    return 'Please fund your wallet before purchasing. <a href="/wallet" style="color: #2d6a4f; text-decoration: underline;">Go to Wallet</a>';
  }
  
  // Check for specific Stellar error codes
  if (code && STELLAR_ERROR_CODE_MAP[code]) {
    return STELLAR_ERROR_CODE_MAP[code];
  }
  
  for (const { match, message } of STELLAR_ERROR_MAP) {
    if (match.test(raw)) return message;
  }
  return err?.message || `An unexpected error occurred (${err?.code || 'unknown'}). Please try again.`;
}
