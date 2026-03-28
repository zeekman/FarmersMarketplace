const router = require('express').Router();
const auth = require('../middleware/auth');
const { getContractState } = require('../utils/stellar');
const { err } = require('../middleware/error');

// GET /api/contracts/:contractId/state?prefix=
router.get('/:contractId/state', auth, async (req, res) => {
  try {
    const { contractId } = req.params;
    const { prefix } = req.query;

    // Validate contractId: 56 chars base32 or 64 hex
    if (!/^[A-Z2-7]{56}$|^[0-9a-fA-F]{64}$/.test(contractId)) {
      return err(res, 400, 'Invalid contractId format (base32 or hex expected)', 'invalid_contract_id');
    }

    const state = await getContractState(contractId, prefix || null);
    res.json({ success: true, data: state });
  } catch (error) {
    if (error.code === 404) {
      return err(res, 404, 'Contract state not found', 'contract_not_found');
    }
    err(res, 500, `Failed to fetch contract state: ${error.message}`, 'rpc_error');
  }
});

module.exports = router;

