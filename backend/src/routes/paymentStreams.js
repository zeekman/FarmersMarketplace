/**
 * Payment Streaming routes — issue #997
 *
 * Exposes contracts/escrow/src/stream.rs's streaming entrypoints
 * (create_stream, withdraw, cancel_stream, decrease_rate_per_second,
 * get_accrued_amount_on_chain) over HTTP, mirroring the auth rules the
 * contract itself enforces:
 *   - sender-only:    creating the stream, decreasing its rate, cancelling it
 *   - recipient-only: withdrawing accrued funds
 *
 * Authorization is checked against the local `payment_streams` mirror table
 * (#996) rather than the chain, so it stays fast; the row is kept current by
 * the streaming indexer job once that lands.
 *
 * NOTE: create_stream / withdraw / cancel_stream are not yet implemented in
 * stream.rs (only decrease_rate_per_second and get_accrued_amount_on_chain
 * exist today) — see the contract-side companion issues. These handlers are
 * wired ahead of that landing, same as the Creator Earnings gap.
 */

const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../db/schema');
const { err } = require('../middleware/error');
const { invokeContract, simulateContract } = require('../utils/stellar');

function validateContractId(contractId) {
  return /^[A-Z2-7]{56}$|^[0-9a-fA-F]{64}$/.test(contractId);
}

function validateStellarAddress(address) {
  return /^G[A-Z2-7]{55}$/.test(address);
}

function parseStreamId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function isPositiveNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

async function getCallerStellarAddress(userId) {
  const { rows } = await db.query('SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1', [
    userId,
  ]);
  return rows[0] || null;
}

async function getStreamRow(contractId, streamId) {
  const { rows } = await db.query(
    'SELECT * FROM payment_streams WHERE contract_id = $1 AND stream_id = $2',
    [contractId, streamId]
  );
  return rows[0] || null;
}

// POST /api/paymentStreams — create a stream (caller is the sender)
// Body: { contract_id, recipient, rate_per_second, deposit, end_time }
router.post('/', auth, async (req, res) => {
  const { contract_id, recipient, rate_per_second, deposit, end_time } = req.body || {};

  if (!validateContractId(contract_id)) {
    return err(res, 400, 'Invalid contract_id format', 'invalid_contract_id');
  }
  if (!validateStellarAddress(recipient)) {
    return err(res, 400, 'Invalid recipient address', 'invalid_recipient');
  }
  if (!isPositiveNumber(rate_per_second)) {
    return err(res, 400, 'rate_per_second must be a positive number', 'validation_error');
  }
  if (!isPositiveNumber(deposit)) {
    return err(res, 400, 'deposit must be a positive number', 'validation_error');
  }
  const endTimeNum = Number(end_time);
  if (!Number.isInteger(endTimeNum) || endTimeNum <= Math.floor(Date.now() / 1000)) {
    return err(res, 400, 'end_time must be a future unix timestamp', 'validation_error');
  }

  const caller = await getCallerStellarAddress(req.user.id);
  if (!caller?.stellar_secret_key) {
    return err(res, 400, 'No Stellar wallet on file for this account', 'no_wallet');
  }
  if (recipient === caller.stellar_public_key) {
    return err(res, 400, 'sender and recipient must differ', 'validation_error');
  }

  try {
    const { hash, result } = await invokeContract({
      contractId: contract_id,
      method: 'create_stream',
      signerSecret: caller.stellar_secret_key,
      args: [
        { type: 'address', value: caller.stellar_public_key },
        { type: 'address', value: recipient },
        { type: 'i128', value: BigInt(Math.round(rate_per_second)) },
        { type: 'i128', value: BigInt(Math.round(deposit)) },
        { type: 'u64', value: endTimeNum },
      ],
    });
    res.status(201).json({ success: true, txHash: hash, result });
  } catch (e) {
    err(res, 502, `Failed to create stream: ${e.message}`, 'contract_error');
  }
});

// GET /api/paymentStreams/:contractId/:streamId/accrued — live accrued amount
// Sender or recipient only.
router.get('/:contractId/:streamId/accrued', auth, async (req, res) => {
  const { contractId } = req.params;
  const streamId = parseStreamId(req.params.streamId);
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format', 'invalid_contract_id');
  }
  if (streamId === null) return err(res, 400, 'Invalid streamId', 'validation_error');

  const stream = await getStreamRow(contractId, streamId);
  if (!stream) return err(res, 404, 'Stream not found', 'stream_not_found');

  const caller = await getCallerStellarAddress(req.user.id);
  const callerAddress = caller?.stellar_public_key;
  if (callerAddress !== stream.sender && callerAddress !== stream.recipient) {
    return err(res, 403, 'Not a participant in this stream', 'forbidden');
  }

  try {
    const sim = await simulateContract({
      contractId,
      method: 'get_accrued_amount_on_chain',
      args: [{ type: 'u64', value: streamId }],
    });
    res.json({ success: true, data: sim });
  } catch (e) {
    err(res, 502, `Failed to read accrued amount: ${e.message}`, 'contract_error');
  }
});

// PATCH /api/paymentStreams/:contractId/:streamId/rate — decrease the streaming rate
// Sender-only. Body: { new_rate }
router.patch('/:contractId/:streamId/rate', auth, async (req, res) => {
  const { contractId } = req.params;
  const streamId = parseStreamId(req.params.streamId);
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format', 'invalid_contract_id');
  }
  if (streamId === null) return err(res, 400, 'Invalid streamId', 'validation_error');

  const { new_rate } = req.body || {};
  if (!isPositiveNumber(new_rate)) {
    return err(res, 400, 'new_rate must be a positive number', 'validation_error');
  }

  const stream = await getStreamRow(contractId, streamId);
  if (!stream) return err(res, 404, 'Stream not found', 'stream_not_found');
  if (new_rate >= stream.rate_per_second) {
    return err(res, 400, 'new_rate must be less than the current rate', 'validation_error');
  }

  const caller = await getCallerStellarAddress(req.user.id);
  if (caller?.stellar_public_key !== stream.sender) {
    return err(res, 403, 'Only the stream sender can decrease the rate', 'forbidden');
  }
  if (!caller?.stellar_secret_key) {
    return err(res, 400, 'No Stellar wallet on file for this account', 'no_wallet');
  }

  try {
    const { hash, result } = await invokeContract({
      contractId,
      method: 'decrease_rate_per_second',
      signerSecret: caller.stellar_secret_key,
      args: [
        { type: 'u64', value: streamId },
        { type: 'address', value: caller.stellar_public_key },
        { type: 'i128', value: BigInt(Math.round(new_rate)) },
      ],
    });
    res.json({ success: true, txHash: hash, result });
  } catch (e) {
    err(res, 502, `Failed to decrease rate: ${e.message}`, 'contract_error');
  }
});

// POST /api/paymentStreams/:contractId/:streamId/withdraw — withdraw accrued funds
// Recipient-only.
router.post('/:contractId/:streamId/withdraw', auth, async (req, res) => {
  const { contractId } = req.params;
  const streamId = parseStreamId(req.params.streamId);
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format', 'invalid_contract_id');
  }
  if (streamId === null) return err(res, 400, 'Invalid streamId', 'validation_error');

  const stream = await getStreamRow(contractId, streamId);
  if (!stream) return err(res, 404, 'Stream not found', 'stream_not_found');

  const caller = await getCallerStellarAddress(req.user.id);
  if (caller?.stellar_public_key !== stream.recipient) {
    return err(res, 403, 'Only the stream recipient can withdraw', 'forbidden');
  }
  if (!caller?.stellar_secret_key) {
    return err(res, 400, 'No Stellar wallet on file for this account', 'no_wallet');
  }

  try {
    const { hash, result } = await invokeContract({
      contractId,
      method: 'withdraw',
      signerSecret: caller.stellar_secret_key,
      args: [
        { type: 'u64', value: streamId },
        { type: 'address', value: caller.stellar_public_key },
      ],
    });
    res.json({ success: true, txHash: hash, result });
  } catch (e) {
    err(res, 502, `Failed to withdraw: ${e.message}`, 'contract_error');
  }
});

// POST /api/paymentStreams/:contractId/:streamId/cancel — cancel the stream
// Sender-only.
router.post('/:contractId/:streamId/cancel', auth, async (req, res) => {
  const { contractId } = req.params;
  const streamId = parseStreamId(req.params.streamId);
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format', 'invalid_contract_id');
  }
  if (streamId === null) return err(res, 400, 'Invalid streamId', 'validation_error');

  const stream = await getStreamRow(contractId, streamId);
  if (!stream) return err(res, 404, 'Stream not found', 'stream_not_found');

  const caller = await getCallerStellarAddress(req.user.id);
  if (caller?.stellar_public_key !== stream.sender) {
    return err(res, 403, 'Only the stream sender can cancel', 'forbidden');
  }
  if (!caller?.stellar_secret_key) {
    return err(res, 400, 'No Stellar wallet on file for this account', 'no_wallet');
  }

  try {
    const { hash, result } = await invokeContract({
      contractId,
      method: 'cancel_stream',
      signerSecret: caller.stellar_secret_key,
      args: [
        { type: 'u64', value: streamId },
        { type: 'address', value: caller.stellar_public_key },
      ],
    });
    res.json({ success: true, txHash: hash, result });
  } catch (e) {
    err(res, 502, `Failed to cancel stream: ${e.message}`, 'contract_error');
  }
});

module.exports = router;
