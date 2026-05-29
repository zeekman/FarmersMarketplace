const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');

function requireFarmer(req, res) {
  if (req.user.role !== 'farmer') {
    err(res, 403, 'Only farmers can manage harvest batches', 'forbidden');
    return false;
  }
  return true;
}

// GET /api/batches — list caller's harvest batches (newest first)
router.get('/', auth, async (req, res) => {
  if (!requireFarmer(req, res)) return;

  const { rows } = await db.query(
    `SELECT id, farmer_id, batch_code, harvest_date, notes, created_at
     FROM harvest_batches
     WHERE farmer_id = $1
     ORDER BY harvest_date DESC, created_at DESC`,
    [req.user.id],
  );
  res.json({ success: true, data: rows });
});

// POST /api/batches — create a batch (unique batch_code per farmer)
router.post('/', auth, async (req, res) => {
  if (!requireFarmer(req, res)) return;

  const batchCode = typeof req.body.batch_code === 'string' ? req.body.batch_code.trim() : '';
  const harvestDate = typeof req.body.harvest_date === 'string' ? req.body.harvest_date.trim() : '';
  const notes = req.body.notes != null ? sanitizeText(String(req.body.notes)) : null;

  if (!batchCode) return err(res, 400, 'batch_code is required', 'validation_error');
  if (!harvestDate || !/^\d{4}-\d{2}-\d{2}$/.test(harvestDate)) {
    return err(res, 400, 'harvest_date is required as YYYY-MM-DD', 'validation_error');
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO harvest_batches (farmer_id, batch_code, harvest_date, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, farmer_id, batch_code, harvest_date, notes, created_at`,
      [req.user.id, batchCode, harvestDate, notes],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) {
      return err(res, 409, 'You already have a batch with this code', 'duplicate_batch_code');
    }
    throw e;
  }
});

module.exports = router;
