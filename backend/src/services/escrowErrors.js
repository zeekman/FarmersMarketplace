'use strict';

/**
 * Error tables for the active Soroban escrow (contracts/escrow) and the
 * deprecated escrow (contract/). These contracts have different numeric
 * discriminants; callers must identify the contract kind explicitly.
 */
const SOROBAN_ESCROW_ERRORS = {
  1: { code: 'escrow_not_found', httpStatus: 404, userMessage: 'No escrow exists for this order.' },
  2: { code: 'escrow_already_settled', httpStatus: 409, userMessage: 'This escrow has already been released or refunded.' },
  3: { code: 'escrow_in_dispute', httpStatus: 409, userMessage: 'This order is in dispute and can only be settled by an arbitrator.' },
  4: { code: 'escrow_unauthorized', httpStatus: 403, userMessage: 'You are not allowed to perform this escrow action.' },
  5: { code: 'escrow_invalid_amount', httpStatus: 400, userMessage: 'The escrow amount is invalid.' },
  6: { code: 'escrow_already_exists', httpStatus: 409, userMessage: 'An escrow already exists for this order.' },
  7: { code: 'escrow_timeout_not_reached', httpStatus: 409, userMessage: 'The escrow timeout has not passed yet.' },
  8: { code: 'escrow_invalid_wasm_hash', httpStatus: 400, userMessage: 'The contract upgrade hash is invalid.' },
  9: { code: 'escrow_no_pending_admin', httpStatus: 409, userMessage: 'There is no pending admin transfer to accept.' },
  10: { code: 'escrow_invalid_token', httpStatus: 400, userMessage: 'The token does not match the one used for this escrow.' },
  11: { code: 'escrow_migration_failed', httpStatus: 500, userMessage: 'The escrow record could not be migrated.' },
  12: { code: 'escrow_not_enough_signatures', httpStatus: 409, userMessage: 'Not enough cooperative signatures to release this escrow.' },
  13: { code: 'escrow_coop_not_configured', httpStatus: 409, userMessage: 'Cooperative signers are not configured.' },
  14: { code: 'escrow_already_initialized', httpStatus: 409, userMessage: 'The escrow contract is already initialized.' },
  15: { code: 'escrow_not_admin', httpStatus: 403, userMessage: 'Only the platform admin can perform this action.' },
  16: { code: 'escrow_below_min_deposit', httpStatus: 400, userMessage: 'The deposit is below the minimum escrow amount.' },
  17: { code: 'escrow_batch_too_large', httpStatus: 400, userMessage: 'Too many escrows in one batch.' },
  18: { code: 'escrow_snapshot_not_found', httpStatus: 404, userMessage: 'No escrow snapshot exists for that ledger.' },
  19: { code: 'escrow_not_yet_releasable', httpStatus: 409, userMessage: 'This pre-order cannot be released before its unlock date.' },
  20: { code: 'escrow_submission_window_closed', httpStatus: 409, userMessage: 'The 48-hour evidence submission window has closed.' },
  21: { code: 'escrow_auto_release_not_reached', httpStatus: 409, userMessage: 'The auto-release time has not been reached yet.' },
  22: { code: 'escrow_too_many_coop_signers', httpStatus: 400, userMessage: 'Too many cooperative signers configured.' },
  23: { code: 'escrow_invalid_timeout', httpStatus: 400, userMessage: 'The escrow timeout is too short.' },
  24: { code: 'escrow_invalid_order_id', httpStatus: 400, userMessage: 'The order ID is out of range for the escrow contract.' },
  25: { code: 'escrow_invalid_royalty', httpStatus: 400, userMessage: 'The cooperative royalty cannot exceed 100%.' },
  26: { code: 'escrow_evidence_limit_reached', httpStatus: 409, userMessage: 'You have already submitted the maximum amount of evidence.' },
  27: { code: 'escrow_not_disputed', httpStatus: 409, userMessage: 'This order is not in dispute.' },
  28: { code: 'escrow_not_initialized', httpStatus: 409, userMessage: 'The escrow contract has not been initialized.' },
  29: { code: 'escrow_invalid_parties', httpStatus: 400, userMessage: 'The buyer, farmer, and cooperative addresses are not a valid combination.' },
  30: { code: 'escrow_invalid_coop_config', httpStatus: 400, userMessage: 'The cooperative signer configuration is invalid.' },
  31: { code: 'escrow_not_in_dispute', httpStatus: 409, userMessage: 'This order is not currently in dispute.' },
  32: { code: 'escrow_invalid_fee_bps', httpStatus: 400, userMessage: 'The platform fee exceeds the 5% maximum.' },
  33: { code: 'escrow_admin_proposal_expired', httpStatus: 409, userMessage: 'The pending admin transfer has expired.' },
};

// Historical discriminants from contract/src/errors.rs. Never use this table
// implicitly: its code 2 is NotFound, while current Soroban code 2 is settled.
const LEGACY_ESCROW_ERRORS = {
  1: { code: 'escrow_already_exists', httpStatus: 409, userMessage: 'An escrow already exists for this order.' },
  2: { code: 'escrow_not_found', httpStatus: 404, userMessage: 'No escrow exists for this order.' },
  3: { code: 'escrow_unauthorized', httpStatus: 403, userMessage: 'You are not allowed to perform this escrow action.' },
  4: { code: 'escrow_not_timed_out', httpStatus: 409, userMessage: 'The escrow timeout has not passed yet.' },
  5: { code: 'escrow_already_settled', httpStatus: 409, userMessage: 'This escrow has already been released or refunded.' },
  6: { code: 'escrow_invalid_parties', httpStatus: 400, userMessage: 'The buyer and farmer addresses must be different.' },
  7: { code: 'escrow_already_initialized', httpStatus: 409, userMessage: 'The escrow contract is already initialized.' },
  8: { code: 'escrow_snapshot_not_found', httpStatus: 404, userMessage: 'No escrow snapshot exists for that ledger.' },
  9: { code: 'escrow_invalid_amount', httpStatus: 400, userMessage: 'The escrow amount is invalid.' },
  10: { code: 'escrow_contract_paused', httpStatus: 409, userMessage: 'The escrow contract is paused.' },
  11: { code: 'escrow_invalid_fee_rate', httpStatus: 400, userMessage: 'The escrow fee rate is invalid.' },
};

const ESCROW_ERROR_TABLES = Object.freeze({
  soroban: SOROBAN_ESCROW_ERRORS,
  legacy: LEGACY_ESCROW_ERRORS,
});

/**
 * Decode a Soroban `Error(Contract, #N)` using the caller-specified contract
 * kind (`soroban` for contracts/escrow, `legacy` for contract/). Returns null
 * for unrecognized errors, codes, or kinds; it never tries another table.
 *
 * @param {unknown} error
 * @param {'soroban' | 'legacy'} contractKind
 * @returns {{ code: string, httpStatus: number, userMessage: string } | null}
 */
function parseEscrowError(error, contractKind) {
  const table = ESCROW_ERROR_TABLES[contractKind];
  if (!table) return null;

  const text = error instanceof Error ? error.message : String(error ?? '');
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(text);
  if (!match) return null;

  return table[Number(match[1])] || null;
}

module.exports = {
  ESCROW_ERROR_TABLES,
  LEGACY_ESCROW_ERRORS,
  SOROBAN_ESCROW_ERRORS,
  parseEscrowError,
};
