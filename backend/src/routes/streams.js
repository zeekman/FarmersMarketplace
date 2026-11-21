/**
 * /streams — the SPA-facing payment stream API (#1368).
 *
 * The SPA addresses a stream by the `payment_streams.id` row id and uses its own
 * field names; routes/paymentStreams.js addresses it by (contractId, streamId).
 * This router lists the caller's streams, then translates each action and
 * forwards it to the paymentStreams router so authorization and contract
 * invocation stay in one place.
 */

const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../db/schema');
const config = require('../config');
const { err } = require('../middleware/error');
const { parsePagination, sendPaginated } = require('../utils/pagination');
const paymentStreamsRouter = require('./paymentStreams');

function forward(req, res, next, url, body) {
  req.url = url;
  req.body = body;
  paymentStreamsRouter(req, res, next);
}

async function getCallerAddress(userId) {
  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [userId]);
  return rows[0]?.stellar_public_key || null;
}

function toClientStream(row, callerAddress) {
  const nowSec = Math.floor(Date.now() / 1000);
  const rate = Number(row.rate_per_second);
  const deposit = Number(row.deposit);
  const accruedAtCheckpoint = Number(row.accrued_at_checkpoint) || 0;
  const accrueUntil = row.cancelled ? Number(row.last_checkpoint_at) : Math.min(nowSec, Number(row.end_time));
  const elapsed = Math.max(0, accrueUntil - Number(row.last_checkpoint_at || 0));
  const accrued = Math.min(deposit, accruedAtCheckpoint + rate * elapsed);

  return {
    id: row.id,
    contract_id: row.contract_id,
    stream_id: row.stream_id,
    sender: row.sender,
    recipient: row.recipient,
    role: row.sender === callerAddress ? 'sender' : 'recipient',
    rate,
    deposit,
    deposit_remaining: Math.max(0, deposit - accrued),
    accrued,
    as_of: new Date(nowSec * 1000).toISOString(),
    ends_at: new Date(Number(row.end_time) * 1000).toISOString(),
    cancelled: !!row.cancelled,
    // Raw contract fields so the client can mirror get_accrued_amount exactly (FE-31).
    rate_per_second: String(row.rate_per_second),
    deposit_stroops: String(row.deposit),
    accrued_at_checkpoint: String(row.accrued_at_checkpoint || 0),
    last_checkpoint_at: Number(row.last_checkpoint_at) || 0,
    start_time: Number(row.start_time) || null,
    end_time: Number(row.end_time),
    withdrawn: String(row.withdrawn || 0),
  };
}

async function getParticipantStream(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    err(res, 400, 'Invalid stream id', 'validation_error');
    return null;
  }
  const { rows } = await db.query('SELECT * FROM payment_streams WHERE id = $1', [id]);
  const row = rows[0];
  const callerAddress = await getCallerAddress(req.user.id);
  if (!row || (row.sender !== callerAddress && row.recipient !== callerAddress)) {
    err(res, 404, 'Stream not found', 'stream_not_found');
    return null;
  }
  return row;
}

// GET /api/streams — streams where the caller is the sender or the recipient
router.get('/', auth, async (req, res) => {
  const callerAddress = await getCallerAddress(req.user.id);
  const { page, limit, offset } = parsePagination(req);
  if (!callerAddress) return sendPaginated(res, req, [], { page, limit, total: 0 });

  const { rows } = await db.query(
    `SELECT * FROM payment_streams WHERE sender = $1 OR recipient = $2
     ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
    [callerAddress, callerAddress, limit, offset]
  );
  const { rows: countRows } = await db.query('SELECT COUNT(*) AS count FROM payment_streams WHERE sender = $1 OR recipient = $2', [callerAddress, callerAddress]);
  return sendPaginated(res, req, rows.map((r) => toClientStream(r, callerAddress)), { page, limit, total: Number(countRows[0]?.count || 0) });
});

// POST /api/streams — Body: { recipient_id | recipient, rate, deposit, ends_at, contract_id? }
router.post('/', auth, async (req, res, next) => {
  const { recipient_id, rate, deposit, ends_at } = req.body || {};

  let recipient = req.body?.recipient;
  if (!recipient && recipient_id != null) {
    const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [recipient_id]);
    recipient = rows[0]?.stellar_public_key;
    if (!recipient) return err(res, 404, 'Recipient not found or has no wallet', 'invalid_recipient');
  }

  const contractId = req.body?.contract_id || config.sorobanEscrowContractId;
  if (!contractId) return err(res, 503, 'Payment streams are not configured', 'not_configured');

  const endMs = Date.parse(ends_at);
  forward(req, res, next, '/', {
    contract_id: contractId,
    recipient,
    rate_per_second: Number(rate),
    deposit: Number(deposit),
    end_time: Number.isNaN(endMs) ? undefined : Math.floor(endMs / 1000),
  });
});

// POST /api/streams/:id/withdraw — recipient withdraws accrued funds
router.post('/:id/withdraw', auth, async (req, res, next) => {
  const row = await getParticipantStream(req, res);
  if (row) forward(req, res, next, `/${row.contract_id}/${row.stream_id}/withdraw`, {});
});

// POST /api/streams/:id/cancel — sender cancels the stream
router.post('/:id/cancel', auth, async (req, res, next) => {
  const row = await getParticipantStream(req, res);
  if (row) forward(req, res, next, `/${row.contract_id}/${row.stream_id}/cancel`, {});
});

// POST /api/streams/:id/top-up — Body: { amount } (sender only)
router.post('/:id/top-up', auth, async (req, res, next) => {
  const row = await getParticipantStream(req, res);
  if (row) forward(req, res, next, `/${row.contract_id}/${row.stream_id}/top-up`, { amount: Number(req.body?.amount) });
});

// PATCH /api/streams/:id/decrease-rate — Body: { rate }
router.patch('/:id/decrease-rate', auth, async (req, res, next) => {
  const row = await getParticipantStream(req, res);
  if (row) {
    forward(req, res, next, `/${row.contract_id}/${row.stream_id}/rate`, { new_rate: Number(req.body?.rate) });
  }
});

module.exports = router;
