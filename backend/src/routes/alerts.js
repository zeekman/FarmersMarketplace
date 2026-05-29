const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const mailer = require('../utils/mailer');

// POST /api/alerts - Create a new crop alert (farmer only)
router.post('/', auth, validate.cropAlert, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Only farmers can create alerts', 'forbidden');
  }

  const { alert_type, description, location, latitude, longitude, severity } = req.body;

  const { rows } = await db.query(
    `INSERT INTO crop_alerts (farmer_id, alert_type, description, location, latitude, longitude, severity)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      req.user.id,
      alert_type,
      sanitizeText(description),
      location ? sanitizeText(location) : null,
      latitude || null,
      longitude || null,
      severity || 'medium',
    ]
  );

  // Notify nearby farmers (async, don't block response)
  if (latitude && longitude) {
    notifyNearbyFarmers(rows[0]).catch((err) =>
      console.error('[Alerts] Failed to notify farmers:', err)
    );
  }

  res.status(201).json({ success: true, data: rows[0] });
});

// GET /api/alerts - Get alerts with optional location filtering
router.get('/', async (req, res) => {
  const { lat, lng, radius = 50 } = req.query;

  let query = `
    SELECT a.*, u.name as farmer_name, u.location as farmer_location
    FROM crop_alerts a
    JOIN users u ON a.farmer_id = u.id
  `;
  const params = [];

  // Simple radius filter (approximate, using lat/lng degrees)
  if (lat && lng) {
    const radiusDegrees = parseFloat(radius) / 111; // ~111km per degree
    query += ` WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
               AND ABS(a.latitude - $1) < $2 AND ABS(a.longitude - $3) < $2`;
    params.push(parseFloat(lat), radiusDegrees, parseFloat(lng));
  }

  query += ` ORDER BY a.created_at DESC LIMIT 100`;

  const { rows } = await db.query(query, params);
  res.json({ success: true, data: rows });
});

// GET /api/alerts/:id - Get single alert
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, u.name as farmer_name, u.location as farmer_location
     FROM crop_alerts a
     JOIN users u ON a.farmer_id = u.id
     WHERE a.id = $1`,
    [req.params.id]
  );

  if (!rows[0]) return err(res, 404, 'Alert not found', 'not_found');
  res.json({ success: true, data: rows[0] });
});

// DELETE /api/alerts/:id - Delete own alert
router.delete('/:id', auth, async (req, res) => {
  const { rows } = await db.query('SELECT farmer_id FROM crop_alerts WHERE id = $1', [
    req.params.id,
  ]);
  if (!rows[0]) return err(res, 404, 'Alert not found', 'not_found');
  if (rows[0].farmer_id !== req.user.id && req.user.role !== 'admin') {
    return err(res, 403, 'Not authorized to delete this alert', 'forbidden');
  }

  await db.query('DELETE FROM crop_alerts WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Alert deleted' });
});

// Helper: Notify nearby farmers via email
async function notifyNearbyFarmers(alert) {
  const radiusDegrees = 50 / 111; // 50km radius
  const { rows: nearbyFarmers } = await db.query(
    `SELECT DISTINCT u.email, u.name
     FROM users u
     LEFT JOIN products p ON p.farmer_id = u.id
     WHERE u.role = 'farmer' AND u.id != $1
       AND p.id IS NOT NULL
     LIMIT 50`,
    [alert.farmer_id]
  );

  const alertTypeLabel =
    { pest: 'Pest', disease: 'Disease', weather: 'Weather', other: 'General' }[alert.alert_type] ||
    'Alert';

  for (const farmer of nearbyFarmers) {
    try {
      await mailer.sendMail({
        to: farmer.email,
        subject: `🚨 New Crop Alert: ${alertTypeLabel}`,
        text: `Hello ${farmer.name},\n\nA nearby farmer has reported a ${alert.alert_type} alert:\n\n${alert.description}\n\nLocation: ${alert.location || 'Not specified'}\nSeverity: ${alert.severity}\n\nStay informed and take necessary precautions.\n\nBest regards,\nFarmers Marketplace`,
      });
    } catch (err) {
      console.error(`[Alerts] Failed to email ${farmer.email}:`, err.message);
    }
  }
}

// GET /api/wallet/alerts — unread alerts for the authenticated user
router.get('/alerts', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, type, message, read_at, created_at
     FROM account_alerts
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.id]
  );
  const unreadCount = rows.filter((r) => !r.read_at).length;
  res.json({ success: true, data: rows, unreadCount });
});

// PATCH /api/wallet/alerts/:id/read — mark an alert as read
router.patch('/alerts/:id/read', auth, async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE account_alerts SET read_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [req.params.id, req.user.id]
  );
  if (rowCount === 0) return err(res, 404, 'Alert not found or already read', 'not_found');
  res.json({ success: true });
});

module.exports = router;
