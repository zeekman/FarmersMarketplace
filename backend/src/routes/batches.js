const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireFarmer(req, res) {
  if (req.user.role !== 'farmer') {
    err(res, 403, 'Only farmers can manage harvest batches', 'forbidden');
    return false;
  }
  return true;
}

// GET /api/batches — list batches; farmer_id query param overrides authenticated user's id
router.get('/', auth, async (req, res) => {
  if (!requireFarmer(req, res)) return;

  let farmerId;
  if (req.query.farmer_id !== undefined) {
    farmerId = parseInt(req.query.farmer_id, 10);
    if (Number.isNaN(farmerId) || farmerId < 1) {
      return err(res, 400, 'farmer_id must be a positive integer', 'validation_error');
    }
  } else {
    farmerId = req.user.id;
  }

  const { rows } = await db.query(
    `SELECT id, uuid, farmer_id, batch_code, harvest_date, location, certifications, notes, qr_code_url, created_at
     FROM harvest_batches
     WHERE farmer_id = $1
     ORDER BY harvest_date DESC, created_at DESC`,
    [farmerId],
  );
  res.json({ success: true, data: rows });
});

// POST /api/batches — create a batch, generating a UUID v4 and QR code PNG
router.post('/', auth, async (req, res) => {
  if (!requireFarmer(req, res)) return;

  const batchCode = typeof req.body.batch_code === 'string' ? req.body.batch_code.trim() : '';
  const harvestDate = typeof req.body.harvest_date === 'string' ? req.body.harvest_date.trim() : '';
  const notes = req.body.notes != null ? sanitizeText(String(req.body.notes)) : null;
  const location = req.body.location != null ? sanitizeText(String(req.body.location)) : null;
  const certifications = req.body.certifications != null ? sanitizeText(String(req.body.certifications)) : null;

  if (!batchCode) return err(res, 400, 'batch_code is required', 'validation_error');
  if (!harvestDate || !/^\d{4}-\d{2}-\d{2}$/.test(harvestDate)) {
    return err(res, 400, 'harvest_date is required as YYYY-MM-DD', 'validation_error');
  }

  const batchUuid = uuidv4();
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
  const verifyUrl = `${backendUrl}/api/batches/${batchUuid}/verify`;
  const qrCodeUrl = await QRCode.toDataURL(verifyUrl);

  try {
    const { rows } = await db.query(
      `INSERT INTO harvest_batches (uuid, farmer_id, batch_code, harvest_date, location, certifications, notes, qr_code_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, uuid, farmer_id, batch_code, harvest_date, location, certifications, notes, qr_code_url, created_at`,
      [batchUuid, req.user.id, batchCode, harvestDate, location, certifications, notes, qrCodeUrl],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) {
      return err(res, 409, 'You already have a batch with this code', 'duplicate_batch_code');
    }
    throw e;
  }
});

// GET /api/batches/:batchId/verify — public, no auth required
router.get('/:batchId/verify', async (req, res) => {
  const { batchId } = req.params;

  if (!UUID_RE.test(batchId)) {
    return err(res, 400, 'Invalid batch ID format', 'validation_error');
  }

  const { rows } = await db.query(
    `SELECT hb.batch_code, hb.harvest_date, hb.certifications,
            u.name AS farmer_name
     FROM harvest_batches hb
     JOIN users u ON hb.farmer_id = u.id
     WHERE hb.uuid = $1`,
    [batchId],
  );

  if (!rows[0]) return err(res, 404, 'Batch not found', 'not_found');

  const batch = rows[0];
  res.json({
    success: true,
    data: {
      batch_code: batch.batch_code,
      harvest_date: batch.harvest_date,
      farmer_name: batch.farmer_name,
      certified: Boolean(batch.certifications && batch.certifications.trim()),
    },
  });
});

module.exports = router;
