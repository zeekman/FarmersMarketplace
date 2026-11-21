const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendDisputeOpenedEmail, sendDisputeResolvedEmail } = require('../utils/mailer');
const { burnRewardTokens } = require('../utils/stellar');
const { invokeEscrowContract } = require('../utils/stellar-contracts');
const { sendPushToUser } = require('../utils/pushNotifications');
const logger = require('../logger');
const { writeAuditLog } = require('../utils/auditLog');
const signerService = require('../services/signerService');
const { decryptUserSecretKey } = require('../utils/crypto');
const { parsePagination, sendPaginated } = require('../utils/pagination');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FileType = require('file-type');

const DISPUTE_WINDOW_HOURS = parseInt(process.env.DISPUTE_WINDOW_HOURS || '72', 10);

// Mirrors the escrow contract's MAX_EVIDENCE_PER_PARTY and EVIDENCE_WINDOW_SECS so
// the API can refuse early with the same error names the contract would return.
const MAX_EVIDENCE_PER_PARTY = 5;
const EVIDENCE_WINDOW_MS = 48 * 60 * 60 * 1000;
const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const EVIDENCE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
const EVIDENCE_DIR = path.join(__dirname, '../../uploads/evidence');

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EVIDENCE_MAX_BYTES, files: MAX_EVIDENCE_PER_PARTY },
  fileFilter: (_req, file, cb) =>
    EVIDENCE_TYPES[file.mimetype]
      ? cb(null, true)
      : cb(Object.assign(new Error('Only JPEG, PNG, WebP and PDF files are allowed'), { status: 400 })),
});

function evidenceWindowClosesAt(dispute) {
  return new Date(new Date(dispute.created_at).getTime() + EVIDENCE_WINDOW_MS);
}

// Loads a dispute with the order parties and checks the caller may see it.
async function loadDisputeForUser(where, param, user) {
  const { rows } = await db.query(
    `SELECT d.*, o.farmer_id, o.total_price, o.quantity, o.escrow_balance_id,
            p.name as product_name, b.name as buyer_name, f.name as farmer_name
     FROM disputes d
     JOIN orders o ON d.order_id = o.id
     JOIN products p ON o.product_id = p.id
     JOIN users b ON d.buyer_id = b.id
     JOIN users f ON o.farmer_id = f.id
     WHERE ${where} = $1`,
    [param]
  );
  const dispute = rows[0];
  if (!dispute) return { status: 404 };
  const party =
    user.id === dispute.buyer_id ? 'buyer' : user.id === dispute.farmer_id ? 'farmer' : null;
  if (!party && user.role !== 'admin') return { status: 403 };
  return { dispute, party };
}

async function serializeDispute(dispute, party) {
  const { rows: evidence } = await db.query(
    `SELECT id, party, file_url, file_name, mime_type, sha256, tx_status, tx_hash, tx_error, created_at
     FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC, id ASC`,
    [dispute.id]
  );
  const closesAt = evidenceWindowClosesAt(dispute);
  const count = (who) => evidence.filter((e) => e.party === who).length;
  const buyerBps =
    dispute.status !== 'resolved'
      ? null
      : dispute.resolution === 'buyer'
        ? 10000
        : dispute.resolution === 'farmer'
          ? 0
          : Math.round(Number(dispute.split_percent_buyer) * 100);
  return {
    ...dispute,
    party,
    buyer_bps: buyerBps,
    evidence,
    evidence_window_closes_at: closesAt.toISOString(),
    evidence_window_open: dispute.status !== 'resolved' && Date.now() <= closesAt.getTime(),
    max_evidence_per_party: MAX_EVIDENCE_PER_PARTY,
    evidence_count: { buyer: count('buyer'), farmer: count('farmer') },
  };
}

// POST /api/disputes — buyer files a dispute on a paid order
router.post('/', auth, validate.dispute, async (req, res, next) => {
  try {
    if (req.user.role !== 'buyer')
      return res.status(403).json({ error: 'Only buyers can file disputes' });

    const order_id = parseInt(req.body.order_id, 10);
    const { reason } = req.body;

    const { rows: orderRows } = await db.query(
      `SELECT o.*, u.stellar_public_key as farmer_wallet, u.id as farmer_id, u.email as farmer_email, u.name as farmer_name
       FROM orders o JOIN users u ON o.farmer_id = u.id
       WHERE o.id = $1 AND o.buyer_id = $2`,
      [order_id, req.user.id]
    );
    const order = orderRows[0];

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'paid')
      return res.status(400).json({ error: 'Disputes can only be filed on paid orders' });

    // Time window check
    const paidAt = new Date(order.updated_at || order.created_at);
    const windowMs = DISPUTE_WINDOW_HOURS * 60 * 60 * 1000;
    if (Date.now() - paidAt.getTime() > windowMs)
      return res.status(400).json({ error: `Disputes must be filed within ${DISPUTE_WINDOW_HOURS} hours of delivery` });

    const { rows: existingRows } = await db.query(
      'SELECT id FROM disputes WHERE order_id = $1',
      [order_id]
    );
    if (existingRows[0])
      return res.status(409).json({ error: 'A dispute already exists for this order' });

    const { rows: inserted } = await db.query(
      'INSERT INTO disputes (order_id, buyer_id, reason, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [order_id, req.user.id, reason.trim(), 'open']
    );
    const disputeId = inserted[0].id;

    // Call escrow contract to mark dispute on-chain (non-fatal)
    const { rows: buyerRows } = await db.query('SELECT id, stellar_public_key FROM users WHERE id = $1', [req.user.id]);
    const buyer = buyerRows[0];
    signerService.signAndSubmit({
      userId: req.user.id,
      purpose: 'dispute_escrow_open',
      req,
      buildTx: async ({ secretKey }) => {
        return invokeEscrowContract({
          action: 'dispute',
          senderSecret: secretKey,
          orderId: order_id,
          buyerPublicKey: buyer?.stellar_public_key,
          farmerPublicKey: order.farmer_wallet,
          userId: req.user.id,
        });
      },
    }).catch((e) => logger.warn('[disputes] escrow open_dispute failed (non-fatal):', e.message));

    // Notify buyer
    sendPushToUser(req.user.id, { title: 'Dispute Filed', body: `Your dispute for order #${order_id} has been submitted.` })
      .catch(() => { });
    sendDisputeOpenedEmail({ buyer, order, farmerName: order.farmer_name, farmerEmail: order.farmer_email })
      .catch(() => { });
    // Notify farmer
    sendPushToUser(order.farmer_id, { title: 'Dispute Opened', body: `A dispute has been filed against order #${order_id}.` })
      .catch(() => { });

    res.status(201).json({ id: disputeId, order_id, status: 'open', message: 'Dispute filed' });
  } catch (err) {
    next(err);
  }
});

// GET /api/disputes — admin lists all disputes
router.get('/', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admins only' });

    const { page, limit, offset } = parsePagination(req);
    const { rows: countRows } = await db.query('SELECT COUNT(*) AS count FROM disputes');
    const total = Number(countRows[0]?.count || 0);
    const { rows } = await db.query(`
      SELECT d.*, u.name as buyer_name, u.email as buyer_email, o.total_price, o.quantity, p.name as product_name
      FROM disputes d JOIN users u ON d.buyer_id = u.id JOIN orders o ON d.order_id = o.id JOIN products p ON o.product_id = p.id
      ORDER BY d.created_at DESC, d.id DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    sendPaginated(res, req, rows, { page, limit, total });
  } catch (err) {
    next(err);
  }
});

// GET /api/disputes/order/:orderId — buyer, farmer or admin views the dispute on an order
router.get('/order/:orderId', auth, async (req, res, next) => {
  try {
    const { dispute, party, status } = await loadDisputeForUser('d.order_id', req.params.orderId, req.user);
    if (status === 404) return res.status(404).json({ error: 'Dispute not found' });
    if (status === 403) return res.status(403).json({ error: 'Forbidden' });
    res.json(await serializeDispute(dispute, party));
  } catch (err) {
    next(err);
  }
});

// GET /api/disputes/:id — buyer, farmer or admin views a dispute with its evidence
router.get('/:id', auth, async (req, res, next) => {
  try {
    const { dispute, party, status } = await loadDisputeForUser('d.id', req.params.id, req.user);
    if (status === 404) return res.status(404).json({ error: 'Dispute not found' });
    if (status === 403) return res.status(403).json({ error: 'Forbidden' });
    res.json(await serializeDispute(dispute, party));
  } catch (err) {
    next(err);
  }
});

// POST /api/disputes/:id/evidence — buyer or farmer uploads up to 5 files (images/PDF, ≤5 MB).
// Each file's SHA-256 is submitted on chain via the escrow contract's submit_evidence().
router.post('/:id/evidence', auth, evidenceUpload.array('files', MAX_EVIDENCE_PER_PARTY), async (req, res, next) => {
  try {
    const { dispute, party, status } = await loadDisputeForUser('d.id', req.params.id, req.user);
    if (status === 404) return res.status(404).json({ error: 'Dispute not found' });
    if (status === 403 || !party)
      return res.status(403).json({ error: 'Only the buyer or farmer can submit evidence' });
    if (dispute.status === 'resolved' || Date.now() > evidenceWindowClosesAt(dispute).getTime())
      return res.status(409).json({ error: 'The 48-hour evidence submission window has closed.', code: 'SubmissionWindowClosed' });

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'At least one file is required' });

    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) as n FROM dispute_evidence WHERE dispute_id = $1 AND party = $2',
      [dispute.id, party]
    );
    if (Number(countRows[0].n) + files.length > MAX_EVIDENCE_PER_PARTY)
      return res.status(409).json({
        error: `You can submit at most ${MAX_EVIDENCE_PER_PARTY} evidence files.`,
        code: 'EvidenceLimitReached',
      });

    // Authoritative type check on the bytes, not the declared MIME type.
    for (const file of files) {
      const detected = await FileType.fromBuffer(file.buffer);
      if (!detected || !EVIDENCE_TYPES[detected.mime])
        return res.status(400).json({ error: `${file.originalname}: unsupported file type` });
      file.detectedMime = detected.mime;
    }

    await fs.promises.mkdir(EVIDENCE_DIR, { recursive: true });
    const { rows: userRows } = await db.query(
      'SELECT stellar_public_key FROM users WHERE id = $1',
      [req.user.id]
    );
    const signer = userRows[0];
    const onChain = String(dispute.escrow_balance_id || '').startsWith('soroban:');

    const created = [];
    for (const file of files) {
      const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const name = `${crypto.randomBytes(16).toString('hex')}${EVIDENCE_TYPES[file.detectedMime]}`;
      await fs.promises.writeFile(path.join(EVIDENCE_DIR, name), file.buffer);
      const { rows } = await db.query(
        `INSERT INTO dispute_evidence (dispute_id, submitted_by, party, file_url, file_name, mime_type, sha256, tx_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [dispute.id, req.user.id, party, `/uploads/evidence/${name}`, file.originalname, file.detectedMime, sha256, onChain ? 'pending' : 'skipped']
      );
      created.push({ id: rows[0].id, sha256 });
    }

    // Submit hashes on chain in the background; the UI polls GET /:id for tx_status.
    if (onChain) {
      (async () => {
        for (const { id, sha256 } of created) {
          try {
            const result = await signerService.signAndSubmit({
              userId: req.user.id,
              purpose: 'dispute_submit_evidence',
              req,
              buildTx: async ({ secretKey }) => {
                return invokeEscrowContract({
                  action: 'submit_evidence',
                  senderSecret: secretKey,
                  orderId: dispute.order_id,
                  evidenceHash: sha256,
                  userId: req.user.id,
                });
              },
            });
            await db.query(
              "UPDATE dispute_evidence SET tx_status = 'confirmed', tx_hash = $1 WHERE id = $2",
              [result?.txHash || null, id]
            );
          } catch (e) {
            logger.warn('[disputes] submit_evidence failed:', e.message);
            await db.query(
              "UPDATE dispute_evidence SET tx_status = 'failed', tx_error = $1 WHERE id = $2",
              [String(e.message).slice(0, 500), id]
            ).catch(() => { });
          }
        }
      })().catch((e) => logger.warn('[disputes] evidence submission aborted:', e.message));
    }

    const otherParty = party === 'buyer' ? dispute.farmer_id : dispute.buyer_id;
    sendPushToUser(otherParty, { title: 'New dispute evidence', body: `New evidence was added to the dispute on order #${dispute.order_id}.` })
      .catch(() => { });

    res.status(201).json(await serializeDispute(dispute, party));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/disputes/:id/resolve — admin/arbitrator resolves a dispute
router.patch('/:id/resolve', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admins only' });

    const { rows: disputeRows } = await db.query(
      `SELECT d.*, o.farmer_id, o.total_price, o.product_id
       FROM disputes d JOIN orders o ON d.order_id = o.id
       WHERE d.id = $1`,
      [req.params.id]
    );
    const dispute = disputeRows[0];
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (dispute.status === 'resolved')
      return res.status(400).json({ error: 'Dispute already resolved' });

    const { buyer_bps } = req.body;
    let { resolution, split_percent_buyer } = req.body;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (buyer_bps !== undefined && !reason)
      return res.status(400).json({ error: 'A reason is required when resolving with buyer_bps' });
    // buyer_bps (0-10000) is the contract's native unit; map it onto the same
    // resolution/split fields so the DB row and audit log stay consistent.
    if (buyer_bps !== undefined) {
      if (!Number.isInteger(buyer_bps) || buyer_bps < 0 || buyer_bps > 10000)
        return res.status(400).json({ error: 'buyer_bps must be an integer between 0 and 10000' });
      resolution = buyer_bps === 10000 ? 'buyer' : buyer_bps === 0 ? 'farmer' : 'split';
      split_percent_buyer = buyer_bps / 100;
    }
    if (!['buyer', 'farmer', 'split'].includes(resolution))
      return res.status(400).json({ error: "resolution must be 'buyer', 'farmer', or 'split'" });
    if (resolution === 'split') {
      // Must be a real number: `"abc" < 0` and `NaN > 100` are both false, so the range
      // check alone would let garbage through to the contract call.
      if (
        typeof split_percent_buyer !== 'number' ||
        !Number.isFinite(split_percent_buyer) ||
        split_percent_buyer < 0 ||
        split_percent_buyer > 100
      )
        return res.status(400).json({ error: 'split_percent_buyer must be 0-100' });
    }
    // Buyer's share of the escrow in basis points (contract `resolve_dispute` arg):
    // 'buyer' = full refund, 'farmer' = full release, 'split' = the given percentage.
    const buyerBps =
      resolution === 'buyer' ? 10000 : resolution === 'farmer' ? 0 : Math.round(split_percent_buyer * 100);

    // Fetch parties
    const [{ rows: buyerRows }, { rows: farmerRows }] = await Promise.all([
      db.query('SELECT * FROM users WHERE id = $1', [dispute.buyer_id]),
      db.query('SELECT * FROM users WHERE id = $1', [dispute.farmer_id]),
    ]);
    const buyer = buyerRows[0];
    const farmer = farmerRows[0];

    // Invoke escrow resolve_dispute (non-fatal). One contract call covers all three
    // outcomes: the contract refunds the buyer's share and pays the farmer's share
    // through the platform-fee / cooperative-royalty deduction (#1299).
    signerService.signAndSubmit({
      userId: req.user.id,
      purpose: 'dispute_resolve',
      req,
      buildTx: async ({ secretKey }) => {
        const escrowPayload = {
          action: 'resolve_dispute',
          senderSecret: secretKey,
          orderId: dispute.order_id,
          buyerPublicKey: buyer?.stellar_public_key,
          farmerPublicKey: farmer?.stellar_public_key,
          buyerBps,
          userId: req.user.id,
        };
        return invokeEscrowContract(escrowPayload);
      },
    }).catch((e) => logger.warn('[disputes] escrow resolve_dispute failed (non-fatal):', e.message));

    await db.query(
      `UPDATE disputes SET status = 'resolved', resolution = $1, split_percent_buyer = $2 WHERE id = $3`,
      [resolution, resolution === 'split' ? split_percent_buyer : null, dispute.id]
    );

    // Audit log — non-fatal
    await writeAuditLog({
      adminId: req.user.id,
      action: 'resolve_dispute',
      targetType: 'dispute',
      targetId: dispute.id,
      before: { status: 'open' },
      after: {
        status: 'resolved',
        resolution,
        split_percent_buyer: resolution === 'split' ? split_percent_buyer : null,
        buyer_bps: buyerBps,
        reason: reason || null,
      },
      req,
    });

    const { rows: productRows } = await db.query('SELECT * FROM products WHERE id = $1', [dispute.product_id]);
    const product = productRows[0];
    const order = { id: dispute.order_id, total_price: dispute.total_price };

    // Notify both parties
    sendDisputeResolvedEmail({ dispute: { ...dispute, resolution }, order, product, buyer })
      .catch(() => { });
    sendPushToUser(dispute.buyer_id, { title: 'Dispute Resolved', body: `Your dispute for order #${dispute.order_id} was resolved: ${resolution}.` })
      .catch(() => { });
    sendPushToUser(dispute.farmer_id, { title: 'Dispute Resolved', body: `Dispute for order #${dispute.order_id} was resolved: ${resolution}.` })
      .catch(() => { });

    // Burn reward tokens (non-fatal)
    if (buyer?.stellar_public_key) {
      const burnAmount = Math.floor(Number(dispute.total_price));
      if (burnAmount > 0) {
        burnRewardTokens(buyer.stellar_public_key, burnAmount)
          .catch((e) => logger.warn('[Rewards] Burn failed on dispute resolve (non-fatal):', { error: e.message }));
      }
    }

    res.json({ id: dispute.id, status: 'resolved', resolution, message: 'Dispute resolved' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
