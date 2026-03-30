const router = require('express').Router();
const auth = require('../middleware/auth');
const { getContractState } = require('../utils/stellar');
const { err } = require('../middleware/error');

// GET /api/contracts/:contractId/state?prefix=  (admin only)
router.get('/:contractId/state', auth, async (req, res) => {
  if (req.user.role !== 'admin') return err(res, 403, 'Admin only', 'forbidden');

  const { contractId } = req.params;
  const { prefix } = req.query;

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

module.exports = router;
