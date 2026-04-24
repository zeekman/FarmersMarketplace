const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { getContractWasmHash, deployContract } = require('../utils/stellar');
const multer = require('multer');

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
  const deactivatedAt = new Date().toISOString();
  await db.query('UPDATE users SET active = 0, deactivated_at = $1 WHERE id = $2', [deactivatedAt, req.params.id]);
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

// GET /api/admin/contracts/:id/invocations?method=&from=&to=&page=
router.get('/contracts/:id/invocations', async (req, res) => {
  const registryId = parseInt(req.params.id, 10);
  if (!Number.isFinite(registryId)) {
    return res.status(400).json({ success: false, error: 'Invalid contract registry id' });
  }
  const { rows: reg } = await db.query('SELECT contract_id FROM contracts_registry WHERE id = $1', [registryId]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });

  const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const conditions = ['contract_id = $1'];
  const params = [reg[0].contract_id];

  if (req.query.method) {
    conditions.push(`method = $${params.length + 1}`);
    params.push(req.query.method);
  }
  if (req.query.from) {
    conditions.push(`invoked_at >= $${params.length + 1}`);
    params.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push(`invoked_at <= $${params.length + 1}`);
    params.push(req.query.to);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) as count FROM contract_invocations ${where}`,
    params,
  );
  const total = parseInt(countRows[0].count, 10);

  const { rows } = await db.query(
    `SELECT ci.id, ci.contract_id, ci.method, ci.args, ci.result, ci.tx_hash,
            ci.success, ci.error, ci.invoked_at, u.name AS invoked_by_name
     FROM contract_invocations ci
     LEFT JOIN users u ON ci.invoked_by = u.id
     ${where}
     ORDER BY ci.invoked_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ── Contract ACL ──────────────────────────────────────────────────────────

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

// GET /api/admin/contracts/:id/acl
router.get('/contracts/:id/acl', async (req, res) => {
  const { rows: reg } = await db.query('SELECT id FROM contracts_registry WHERE id = $1', [req.params.id]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });
  const { rows } = await db.query(
    `SELECT ca.id, ca.contract_id, ca.address, ca.role, ca.granted_at,
            u.name AS granted_by_name
     FROM contract_acl ca
     LEFT JOIN users u ON ca.granted_by = u.id
     WHERE ca.contract_id = (SELECT contract_id FROM contracts_registry WHERE id = $1)
     ORDER BY ca.granted_at DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/admin/contracts/:id/acl
router.post('/contracts/:id/acl', async (req, res) => {
  const { address, role = 'admin' } = req.body;
  if (!address || !STELLAR_ADDRESS_RE.test(address)) {
    return res.status(400).json({ success: false, error: 'Invalid Stellar address', code: 'invalid_address' });
  }
  const { rows: reg } = await db.query('SELECT contract_id FROM contracts_registry WHERE id = $1', [req.params.id]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });
  try {
    const { rows } = await db.query(
      'INSERT INTO contract_acl (contract_id, address, role, granted_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [reg[0].contract_id, address, role, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505' || (e.message && e.message.includes('UNIQUE'))) {
      return res.status(409).json({ success: false, error: 'Address already in ACL', code: 'duplicate' });
    }
    throw e;
  }
});

// DELETE /api/admin/contracts/:id/acl/:address
router.delete('/contracts/:id/acl/:address', async (req, res) => {
  const { rows: reg } = await db.query('SELECT contract_id FROM contracts_registry WHERE id = $1', [req.params.id]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });
  const { rowCount } = await db.query(
    'DELETE FROM contract_acl WHERE contract_id = $1 AND address = $2',
    [reg[0].contract_id, req.params.address]
  );
  if (!rowCount) return res.status(404).json({ success: false, error: 'ACL entry not found' });
  res.json({ success: true, message: 'Access revoked' });
});

// GET /api/admin/contracts/:id/state/export — download contract storage as JSON or CSV
router.get('/contracts/:id/state/export', async (req, res) => {
  const registryId = parseInt(req.params.id, 10);
  if (!Number.isFinite(registryId)) {
    return res.status(400).json({ success: false, error: 'Invalid contract registry id' });
  }

  const { rows: reg } = await db.query(
    'SELECT contract_id FROM contracts_registry WHERE id = $1',
    [registryId],
  );
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });

  const format = (req.query.format || 'json').toLowerCase();
  if (!['json', 'csv'].includes(format)) {
    return res.status(400).json({ success: false, error: 'format must be json or csv' });
  }

  const sinceLedger = req.query.since_ledger ? parseInt(req.query.since_ledger, 10) : null;
  if (req.query.since_ledger !== undefined && !Number.isFinite(sinceLedger)) {
    return res.status(400).json({ success: false, error: 'since_ledger must be an integer' });
  }

  const { getContractState } = require('../utils/stellar');
  let entries;
  try {
    entries = await getContractState(reg[0].contract_id, null);
  } catch (e) {
    if (e.code === 404 || e.message?.includes('not found')) {
      return res.status(404).json({ success: false, error: 'Contract not found on Soroban RPC' });
    }
    return res.status(502).json({ success: false, error: e.message || 'RPC error' });
  }

  // Incremental filter: entries carry lastModifiedLedgerSeq from the RPC response
  if (sinceLedger !== null) {
    entries = entries.filter(
      (e) => e.lastModifiedLedgerSeq != null && e.lastModifiedLedgerSeq > sinceLedger,
    );
  }

  const contractId = reg[0].contract_id;
  const exportedAt = new Date().toISOString();
  const ledgerSeq = entries[0]?.lastModifiedLedgerSeq ?? null;
  const slug = contractId.slice(0, 8).toLowerCase();
  const ts = exportedAt.slice(0, 10);

  if (format === 'csv') {
    const escape = (v) => {
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const rows = [
      `# contract_id: ${contractId}`,
      `# exported_at: ${exportedAt}`,
      sinceLedger !== null ? `# since_ledger: ${sinceLedger}` : null,
      'key,value,durability,last_modified_ledger',
      ...entries.map((e) =>
        [escape(e.key), escape(e.val), escape(e.durability), escape(e.lastModifiedLedgerSeq)].join(','),
      ),
    ]
      .filter(Boolean)
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="contract-state-${slug}-${ts}.csv"`);
    return res.send(rows);
  }

  // JSON
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="contract-state-${slug}-${ts}.json"`);
  res.json({
    contract_id: contractId,
    exported_at: exportedAt,
    ledger_sequence: ledgerSeq,
    ...(sinceLedger !== null && { since_ledger: sinceLedger }),
    entries: entries.map(({ key, val, durability, lastModifiedLedgerSeq }) => ({
      key,
      value: val,
      durability,
      last_modified_ledger: lastModifiedLedgerSeq ?? null,
    })),
  });
});

// POST /api/admin/contracts/deploy — upload WASM file and deploy contract
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/wasm' || !file.originalname.endsWith('.wasm')) {
      return cb(new Error('Only .wasm files are allowed'));
    }
    cb(null, true);
  },
});

router.post('/contracts/deploy', upload.single('wasm'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'WASM file is required' });
    }

    const { name, type } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, error: 'name and type are required' });
    }
    if (!['escrow', 'token', 'other'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type must be escrow, token, or other' });
    }

    // Get deployer secret from env
    const deployerSecret = process.env.SOROBAN_DEPLOYER_SECRET;
    if (!deployerSecret) {
      return res.status(500).json({ success: false, error: 'SOROBAN_DEPLOYER_SECRET not configured' });
    }

    // Deploy the contract
    const { contractId, wasmHash, txHash } = await deployContract({
      wasmBuffer: req.file.buffer,
      deployerSecret,
    });

    // Register in database
    const { rows } = await db.query(
      `INSERT INTO contracts_registry (contract_id, name, type, network, wasm_hash, deployed_by) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [contractId, name.trim(), type, STELLAR_NETWORK, wasmHash, req.user.id]
    );

    res.status(201).json({
      success: true,
      data: {
        contract_id: contractId,
        wasm_hash: wasmHash,
        deployment_tx_hash: txHash,
        registry: rows[0],
      },
    });
  } catch (error) {
    console.error('Contract deployment error:', error);
    if (error.message.includes('Only .wasm files are allowed')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Contract deployment failed: ' + error.message });
// ── Contract Documentation & Analysis ──────────────────────────────────────

const { getContractABI, analyzeContractFees } = require('../utils/stellar');
const cache = require('../cache');

// GET /api/admin/contracts/:id/docs - Generate and cache contract ABI documentation
router.get('/contracts/:id/docs', async (req, res) => {
  const { rows: reg } = await db.query('SELECT contract_id FROM contracts_registry WHERE id = $1', [req.params.id]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });

  const contractId = reg[0].contract_id;
  const cacheKey = `contract_abi:${contractId}`;

  // Try cache first
  let abi = await cache.get(cacheKey);
  if (abi) {
    return res.json({ success: true, data: { abi, cached: true } });
  }

  try {
    abi = await getContractABI(contractId);
    
    // Generate markdown documentation
    let markdown = `# Contract ABI Documentation\n\n`;
    markdown += `**Contract ID:** \`${contractId}\`\n\n`;
    markdown += `## Functions\n\n`;

    if (!abi || abi.length === 0) {
      markdown += `No functions found in contract specification.\n`;
    } else {
      for (const func of abi) {
        markdown += `### ${func.name}\n\n`;
        markdown += `**Parameters:**\n`;
        if (func.params && func.params.length > 0) {
          for (const param of func.params) {
            markdown += `- \`${param.name}\` (\`${param.type}\`)\n`;
          }
        } else {
          markdown += `- None\n`;
        }
        markdown += `\n**Return Type:** \`${func.returnType}\`\n\n`;
      }
    }

    const docs = { abi, markdown, generatedAt: new Date().toISOString() };
    
    // Cache for 10 minutes
    await cache.set(cacheKey, docs, 600);

    res.json({ success: true, data: docs });
  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({ success: false, error: 'Contract not found on Soroban RPC' });
    }
    res.status(502).json({ success: false, error: error.message || 'Failed to fetch contract ABI' });
  }
});

// POST /api/admin/contracts/:id/analyze-fees - Analyze contract invocation fees
router.post('/contracts/:id/analyze-fees', async (req, res) => {
  const { rows: reg } = await db.query('SELECT contract_id FROM contracts_registry WHERE id = $1', [req.params.id]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });

  const { testCases } = req.body;
  if (!Array.isArray(testCases) || testCases.length === 0) {
    return res.status(400).json({ success: false, error: 'testCases must be a non-empty array' });
  }

  // Validate test cases
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!tc.method || typeof tc.method !== 'string') {
      return res.status(400).json({ success: false, error: `testCases[${i}].method is required` });
    }
    if (!Array.isArray(tc.args)) {
      return res.status(400).json({ success: false, error: `testCases[${i}].args must be an array` });
    }
  }

  try {
    const analysis = await analyzeContractFees(reg[0].contract_id, testCases);
    
    // Highlight expensive operations (> 1M CPU instructions)
    const results = analysis.map(r => ({
      ...r,
      expensive: r.cpu_insns && r.cpu_insns > 1_000_000,
    }));

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message || 'Fee analysis failed' });
  }
});

// GET /api/admin/contracts/:id/compare?v1=hash1&v2=hash2
// Compare two WASM versions of a contract by diffing their function signatures.
// Results are cached for 10 minutes.
const { getContractFunctionSignatures } = require('../utils/stellar');

router.get('/contracts/:id/compare', async (req, res) => {
  const { v1, v2 } = req.query;
  if (!v1 || !v2) {
    return res.status(400).json({ success: false, error: 'v1 and v2 query params are required', code: 'missing_params' });
  }

  const { rows: reg } = await db.query('SELECT contract_id FROM contracts_registry WHERE id = $1', [req.params.id]);
  if (!reg[0]) return res.status(404).json({ success: false, error: 'Contract not found' });

  const contractId = reg[0].contract_id;
  const cacheKey = `contract_compare:${contractId}:${v1}:${v2}`;

  const cached = await cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: { ...cached, cached: true } });

  // Fetch signatures for both versions.
  // Since we can only query the live contract, we use the contractId for both
  // and note that v1/v2 are the WASM hashes the caller wants to compare.
  // We fetch the current live signatures and compare against what's recorded
  // in the upgrade audit trail.
  let v1Sigs, v2Sigs;
  try {
    // Try to get signatures from the live contract (represents the current/v2 state)
    const liveSigs = await getContractFunctionSignatures(contractId);

    // Look up upgrade records to find the old WASM hash's recorded state
    const { rows: upgrades } = await db.query(
      `SELECT old_wasm_hash, new_wasm_hash FROM contract_upgrades
       WHERE contract_id = $1 ORDER BY upgraded_at DESC`,
      [contractId]
    );

    // Build a simple map: wasm_hash → "before" or "after" based on upgrade history
    // For the comparison we use the live signatures as the "new" version
    // and an empty map as fallback for the "old" version if not available
    const normalizedV1 = v1.trim().toLowerCase().replace(/^0x/, '');
    const normalizedV2 = v2.trim().toLowerCase().replace(/^0x/, '');

    // Check if v2 matches the current on-chain hash
    const { getContractWasmHash } = require('../utils/stellar');
    let currentHash;
    try {
      currentHash = await getContractWasmHash(contractId);
    } catch {
      currentHash = null;
    }

    if (currentHash === normalizedV2) {
      v2Sigs = liveSigs;
    } else if (currentHash === normalizedV1) {
      v1Sigs = liveSigs;
    }

    // If we couldn't match either hash to the live contract, return 404
    if (!v1Sigs && !v2Sigs) {
      return res.status(404).json({
        success: false,
        error: 'Neither v1 nor v2 hash matches the current on-chain contract WASM',
        code: 'hash_not_found',
      });
    }

    // The version we couldn't fetch live gets an empty signature set
    // (represents a version with no known functions — e.g. before spec was added)
    v1Sigs = v1Sigs || new Map();
    v2Sigs = v2Sigs || new Map();
  } catch (e) {
    if (e.code === 404) {
      return res.status(404).json({ success: false, error: e.message, code: 'contract_not_found' });
    }
    return res.status(502).json({ success: false, error: e.message || 'Soroban RPC error', code: 'rpc_error' });
  }

  // Diff the two signature maps
  const added = [];
  const removed = [];
  const changed = [];

  for (const [name, sig] of v2Sigs) {
    if (!v1Sigs.has(name)) {
      added.push({ name, signature: sig });
    } else if (v1Sigs.get(name) !== sig) {
      changed.push({ name, old_signature: v1Sigs.get(name), new_signature: sig });
    }
  }
  for (const [name, sig] of v1Sigs) {
    if (!v2Sigs.has(name)) {
      removed.push({ name, signature: sig });
    }
  }

  const diff = { v1, v2, added, removed, changed };
  await cache.set(cacheKey, diff, 600); // cache 10 minutes

  res.json({ success: true, data: diff });
// ── Contract Alerts ────────────────────────────────────────────────────────

// GET /api/admin/contract-alerts
router.get('/contract-alerts', async (req, res) => {
  const { acknowledged } = req.query;
  const conditions = [];
  const params = [];
  if (acknowledged !== undefined) {
    conditions.push(`acknowledged = $${params.length + 1}`);
    params.push(acknowledged === 'true' ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM contract_alerts ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  res.json({ success: true, data: rows });
});

// PATCH /api/admin/contract-alerts/:id/acknowledge
router.patch('/contract-alerts/:id/acknowledge', async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE contract_alerts SET acknowledged = 1 WHERE id = $1`,
    [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ success: false, error: 'Alert not found' });
  res.json({ success: true });
});

module.exports = router;
