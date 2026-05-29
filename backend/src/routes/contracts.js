const router = require('express').Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const db = require('../db/schema');
const { getContractState, getContractEvents, simulateContractCall } = require('../utils/stellar');
const { err } = require('../middleware/error');

function validateContractId(contractId) {
  return /^[A-Z2-7]{56}$|^[0-9a-fA-F]{64}$/.test(contractId);
}

const ARGS_MAX_BYTES = 65535;

function argsExceedLimit(args) {
  if (args == null) return false;
  return JSON.stringify(args).length > ARGS_MAX_BYTES;
}

async function logInvocation({ contractId, method, args, result, txHash, success, error, userId }) {
  try {
    await db.query(
      `INSERT INTO contract_invocations (contract_id, method, args, result, tx_hash, success, error, invoked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contractId,
        method,
        args != null ? JSON.stringify(args) : null,
        result != null ? JSON.stringify(result) : null,
        txHash || null,
        success ? 1 : 0,
        error || null,
        userId || null,
      ],
    );
  } catch {
    // non-fatal — don't break the response if logging fails
  }
}

// POST /api/contracts/:contractId/simulate  (admin only)
router.post('/:contractId/simulate', auth, adminAuth, async (req, res) => {
  const { contractId } = req.params;
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format (base32 or hex expected)', 'invalid_contract_id');
  }

  const { method, args } = req.body || {};
  if (typeof method !== 'string' || !method.trim()) {
    return err(res, 400, 'method is required', 'invalid_body');
  }
  if (args !== undefined && !Array.isArray(args)) {
    return err(res, 400, 'args must be an array', 'invalid_body');
  }
  if (argsExceedLimit(args)) {
    return err(res, 400, `args must not exceed ${ARGS_MAX_BYTES} bytes when serialized`, 'args_too_large');
  }

  const net = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
  const { rows } = await db.query(
    'SELECT contract_id, network FROM contracts_registry WHERE contract_id = $1',
    [contractId],
  );
  if (!rows[0] || rows[0].network !== net) {
    return err(res, 404, 'Contract not found', 'contract_not_found');
  }

  let out;
  try {
    out = await simulateContractCall(contractId, method.trim(), args || []);
  } catch (e) {
    await logInvocation({ contractId, method: method.trim(), args, result: null, success: false, error: e.message, userId: req.user.id });
    if (e.code === 'simulation_source_unconfigured') return err(res, 503, e.message, e.code);
    if (e.code === 'simulation_source_not_found') return err(res, 502, e.message, e.code);
    if (e.code === 'invalid_arg') return err(res, 400, e.message, e.code);
    if (e.code === 'sdk_incompatible') return err(res, 500, e.message, e.code);
    out = { success: false, fee: null, result: null, error: e.message || 'Simulation failed' };
    return res.status(200).json(out);
  }

  await logInvocation({ contractId, method: method.trim(), args, result: out.result, success: !!out.success, error: out.error || null, userId: req.user.id });
  return res.json(out);
});

// GET /api/contracts/:contractId/state?prefix=
// Admins: unrestricted. Non-admins: only contracts linked to their own orders.
router.get('/:contractId/state', auth, async (req, res) => {
  const { contractId } = req.params;
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format (base32 or hex expected)', 'invalid_contract_id');
  }

  // Validate prefix to prevent injection (printable ASCII, no control chars)
  const prefix = req.query.prefix || null;
  if (prefix !== null && !/^[\x20-\x7E]{0,128}$/.test(prefix)) {
    return err(res, 400, 'Invalid prefix parameter', 'invalid_prefix');
  }

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin) {
    // Non-admins may only query contracts associated with their own orders
    const { rows } = await db.query(
      `SELECT 1 FROM orders o
       JOIN contracts_registry cr ON cr.contract_id = $1
       WHERE o.buyer_id = $2 AND o.escrow_balance_id LIKE 'soroban:%'
       LIMIT 1`,
      [contractId, req.user.id],
    );
    if (!rows.length) {
      return err(res, 403, 'Access denied', 'forbidden');
    }
  }

  try {
    const state = await getContractState(contractId, prefix);
    res.json({ success: true, data: state });
  } catch (error) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return err(res, 404, 'Contract not found', 'contract_not_found');
    }
    err(res, 500, `Failed to fetch contract state: ${error.message}`, 'rpc_error');
  }
});

// GET /api/contracts/:contractId/events?type=&from=&to=&page=  (admin only)
router.get('/:contractId/events', auth, adminAuth, async (req, res) => {
  const { contractId } = req.params;
  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format (base32 or hex expected)', 'invalid_contract_id');
  }

  try {
    const result = await getContractEvents(contractId, {
      type: req.query.type || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      page: Math.max(1, parseInt(req.query.page, 10) || 1),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return err(res, 404, 'Contract not found', 'contract_not_found');
    }
    err(res, 500, `Failed to fetch contract events: ${error.message}`, 'rpc_error');
  }
});

module.exports = router;

// .
