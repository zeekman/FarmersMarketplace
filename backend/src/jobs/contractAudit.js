/**
 * jobs/contractAudit.js
 *
 * Records an audit row in contract_invocations for every Soroban contract call the
 * backend makes (escrow deposit/release/refund/dispute, carbon offset, reward mints).
 *
 * The `args` column is capped at ARGS_LIMIT characters (see migration
 * 014_contract_invocations_args_limit.sql). Serialized args longer than that are
 * truncated before INSERT — relying on the DB CHECK constraint to reject the row
 * would silently drop the whole audit record instead of just the oversized field.
 */

const db = require('../db/schema');
const logger = require('../logger');

const ARGS_LIMIT = 4000;

function serializeArgs(args) {
  if (args === undefined || args === null) return null;
  return typeof args === 'string' ? args : JSON.stringify(args);
}

function truncateArgsForAudit(serialized, contractId) {
  if (serialized === null || serialized.length <= ARGS_LIMIT) return serialized;

  logger.warn('[contractAudit] Truncating oversized contract invocation args', {
    contractId,
    originalSize: serialized.length,
    limit: ARGS_LIMIT,
  });

  return serialized.slice(0, ARGS_LIMIT);
}

/**
 * Log a contract invocation. Call this alongside (not instead of) the actual
 * on-chain call — this is an audit trail, not the source of truth for tx state.
 */
async function recordContractInvocation({ contractId, action, args, txHash, status = 'success' }) {
  const serialized = truncateArgsForAudit(serializeArgs(args), contractId);

  await db.query(
    'INSERT INTO contract_invocations (contract_id, action, args, tx_hash, status) VALUES ($1, $2, $3, $4, $5)',
    [contractId, action, serialized, txHash || null, status]
  );
}

module.exports = { recordContractInvocation, ARGS_LIMIT };
