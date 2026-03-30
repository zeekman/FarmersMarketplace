const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { getContractWasmHash } = require('../utils/stellar');

const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();

function normalizeWasmHash(h) {
  if (h == null || typeof h !== 'string') return null;
  const x = h.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(x)) return null;
  return x;
}

router.use(auth, adminAuth);

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;

  const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM users');
  const total = parseInt(countRows[0].count);

  const { rows: users } = await db.query(
    'SELECT id, name, email, role, stellar_public_key, created_at, active FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  res.json({
    success: true,
    data: users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const { rows } = await db.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
  if (rows[0].role === 'admin')
    return res.status(400).json({ success: false, error: 'Cannot deactivate another admin' });
  await db.query('UPDATE users SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'User deactivated' });
});

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  const { rows: u } = await db.query('SELECT COUNT(*) as count FROM users');
  const { rows: p } = await db.query('SELECT COUNT(*) as count FROM products');
  const { rows: o } = await db.query('SELECT COUNT(*) as count FROM orders');
  const { rows: r } = await db.query(
    `SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = 'paid'`
  );

  // Fee bump stats — count orders where fee_bumped flag is set
  let feeBumpCount = 0;
  try {
    const { rows: fb } = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE fee_bumped = TRUE`
    );
    feeBumpCount = parseInt(fb[0].count) || 0;
  } catch {
    /* column may not exist yet */
  }

  res.json({
    success: true,
    data: {
      users: parseInt(u[0].count),
      products: parseInt(p[0].count),
      orders: parseInt(o[0].count),
      total_revenue_xlm: r[0].total,
      fee_bump_count: feeBumpCount,
      fee_bump_enabled: !!process.env.PLATFORM_FEE_ACCOUNT_SECRET,
    },
  });
});

// ── Contract Registry ──────────────────────────────────────────────────────

// GET /api/admin/contracts
router.get('/contracts', async (req, res) => {
  const { network, type } = req.query;
  const conditions = [];
  const params = [];
  if (network) {
    conditions.push(`network = $${params.length + 1}`);
    params.push(network);
  }
  if (type) {
    conditions.push(`type = $${params.length + 1}`);
    params.push(type);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT cr.*, u.name as deployed_by_name FROM contracts_registry cr
     LEFT JOIN users u ON cr.deployed_by = u.id ${where} ORDER BY cr.deployed_at DESC`,
    params
  );
  res.json({ success: true, data: rows });
});

// POST /api/admin/contracts
router.post('/contracts', async (req, res) => {
  const { contract_id, name, type, network } = req.body;
  if (!contract_id || !name || !type || !network) {
    return res
      .status(400)
      .json({ success: false, error: 'contract_id, name, type, and network are required' });
  }
  if (!['escrow', 'token', 'other'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type must be escrow, token, or other' });
  }
  if (!['testnet', 'mainnet'].includes(network)) {
    return res.status(400).json({ success: false, error: 'network must be testnet or mainnet' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO contracts_registry (contract_id, name, type, network, deployed_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [contract_id.trim(), name.trim(), type, network, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) {
      return res
        .status(409)
        .json({ success: false, error: 'Contract ID already registered', code: 'duplicate' });
    }
    throw e;
  }
});

// DELETE /api/admin/contracts/:id
router.delete('/contracts/:id', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM contracts_registry WHERE id = $1', [
    req.params.id,
  ]);
  if (!rowCount) return res.status(404).json({ success: false, error: 'Contract not found' });
  res.json({ success: true, message: 'Contract deregistered' });
});

// GET /api/admin/contracts/:id/upgrades — immutable audit trail (newest first)
router.get('/contracts/:id/upgrades', async (req, res) => {
  const registryId = parseInt(req.params.id, 10);
  if (!Number.isFinite(registryId)) {
    return res.status(400).json({ success: false, error: 'Invalid contract registry id' });
  }
  const { rows: reg } = await db.query('SELECT id, contract_id FROM contracts_registry WHERE id = $1', [registryId]);
  if (!reg[0]) {
    return res.status(404).json({ success: false, error: 'Contract not found' });
  }
  const { rows } = await db.query(
    `SELECT cu.id, cu.contract_id, cu.old_wasm_hash, cu.new_wasm_hash, cu.upgraded_at,
            u.name AS upgraded_by_name, cu.upgraded_by
     FROM contract_upgrades cu
     LEFT JOIN users u ON cu.upgraded_by = u.id
     WHERE cu.contract_id = $1
     ORDER BY cu.upgraded_at DESC, cu.id DESC`,
    [reg[0].contract_id],
  );
  res.json({ success: true, data: rows });
});

// POST /api/admin/contracts/:id/upgrade — record upgrade (new WASM hash verified on Soroban RPC)
router.post('/contracts/:id/upgrade', async (req, res) => {
  const registryId = parseInt(req.params.id, 10);
  if (!Number.isFinite(registryId)) {
    return res.status(400).json({ success: false, error: 'Invalid contract registry id' });
  }
  const oldH = normalizeWasmHash(req.body?.old_wasm_hash);
  const newH = normalizeWasmHash(req.body?.new_wasm_hash);
  if (!oldH || !newH) {
    return res.status(400).json({
      success: false,
      error: 'old_wasm_hash and new_wasm_hash must be 64-character hex strings',
    });
  }

  const { rows } = await db.query(
    'SELECT id, contract_id, network FROM contracts_registry WHERE id = $1',
    [registryId],
  );
  if (!rows[0]) {
    return res.status(404).json({ success: false, error: 'Contract not found' });
  }
  const row = rows[0];
  if (row.network !== STELLAR_NETWORK) {
    return res.status(400).json({
      success: false,
      error: `Contract network (${row.network}) does not match server STELLAR_NETWORK (${STELLAR_NETWORK})`,
    });
  }

  let chainNew;
  try {
    chainNew = await getContractWasmHash(row.contract_id);
  } catch (e) {
    if (e.code === 404) {
      return res.status(502).json({
        success: false,
        error: 'Could not load contract from Soroban RPC',
        code: 'rpc_not_found',
      });
    }
    return res.status(502).json({
      success: false,
      error: e.message || 'Soroban RPC failed',
      code: 'rpc_error',
    });
  }

  if (chainNew !== newH) {
    return res.status(400).json({
      success: false,
      error: 'new_wasm_hash does not match the WASM hash reported by Soroban RPC for this contract',
      code: 'wasm_hash_mismatch',
      expected: chainNew,
    });
  }

  try {
    const ins = await db.query(
      `INSERT INTO contract_upgrades (contract_id, old_wasm_hash, new_wasm_hash, upgraded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, contract_id, old_wasm_hash, new_wasm_hash, upgraded_by, upgraded_at`,
      [row.contract_id, oldH, newH, req.user.id],
    );
    res.status(201).json({ success: true, data: ins.rows[0] });
  } catch (e) {
    if (e.code === '23503' || (e.message && e.message.includes('FOREIGN KEY'))) {
      return res.status(400).json({ success: false, error: 'Invalid contract or user reference' });
    }
    throw e;
  }
});

// GET /api/admin/farmers/pending - Get farmers pending verification
router.get('/farmers/pending', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, email, verification_status, verification_docs, created_at
     FROM users
     WHERE role = 'farmer' AND verification_status = 'pending'
     ORDER BY created_at ASC`
  );
  res.json({ success: true, data: rows });
});

// PATCH /api/admin/farmers/:id/verify - Approve or reject verification
router.patch('/farmers/:id/verify', async (req, res) => {
  const { status, reason } = req.body;

  if (!['verified', 'rejected'].includes(status)) {
    return res
      .status(400)
      .json({
        success: false,
        error: 'status must be verified or rejected',
        code: 'validation_error',
      });
  }

  const { rows } = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [
    req.params.id,
  ]);
  if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
  if (rows[0].role !== 'farmer')
    return res.status(400).json({ success: false, error: 'User is not a farmer' });

  await db.query('UPDATE users SET verification_status = $1 WHERE id = $2', [
    status,
    req.params.id,
  ]);

  // Send notification email
  const mailer = require('../utils/mailer');
  const farmer = rows[0];
  const subject =
    status === 'verified' ? '✅ Farmer Verification Approved' : '❌ Farmer Verification Rejected';
  const message =
    status === 'verified'
      ? `Hello ${farmer.name},\n\nYour farmer verification has been approved! You now have a verified badge on your profile.\n\nThank you for being part of our trusted community.\n\nBest regards,\nFarmers Marketplace`
      : `Hello ${farmer.name},\n\nYour farmer verification request has been reviewed and could not be approved at this time.\n\n${reason ? `Reason: ${reason}` : ''}\n\nPlease contact support if you have questions.\n\nBest regards,\nFarmers Marketplace`;

  mailer
    .sendMail({ to: farmer.email, subject, text: message })
    .catch((e) => console.error('[Admin] Failed to send verification email:', e.message));

  res.json({ success: true, message: `Farmer ${status}` });
});

module.exports = router;
