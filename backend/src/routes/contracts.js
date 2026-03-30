const router = require('express').Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { getContractState, getContractEvents } = require('../utils/stellar');
const { err } = require('../middleware/error');

function validateContractId(contractId) {
  return /^[A-Z2-7]{56}$|^[0-9a-fA-F]{64}$/.test(contractId);
}

// GET /api/contracts/:contractId/state?prefix=  (admin only)
router.get('/:contractId/state', auth, async (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admin only', 'forbidden');

  const { contractId } = req.params;
  const { prefix } = req.query;

  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format (base32 or hex expected)', 'invalid_contract_id');
  if (!/^[A-Z2-7]{56}$|^[0-9a-fA-F]{64}$/.test(contractId)) {
    return err(
      res,
      400,
      'Invalid contractId format (base32 or hex expected)',
      'invalid_contract_id'
    );
  }

  try {
    const state = await getContractState(contractId, prefix || null);
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
  const { type, from, to, page = '1' } = req.query;

  if (!validateContractId(contractId)) {
    return err(res, 400, 'Invalid contractId format (base32 or hex expected)', 'invalid_contract_id');
  }

  try {
    const result = await getContractEvents(contractId, {
      type: type || undefined,
      from: from || undefined,
      to: to || undefined,
      page: Math.max(1, parseInt(page, 10) || 1),
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
