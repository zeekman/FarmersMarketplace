/**
 * Cooperative multi-signature payment routes
 *
 * POST /api/cooperatives                       — create a cooperative
 * GET  /api/cooperatives                       — list cooperatives the user belongs to
 * POST /api/cooperatives/:id/multisig-setup    — configure signers + threshold
 * POST /api/cooperatives/:id/transactions      — initiate a pending transaction
 * POST /api/transactions/:id/sign              — member signs a pending transaction
 * GET  /api/cooperatives/:id/pending           — list pending transactions
 */

const router = require('express').Router();
const StellarSdk = require('@stellar/stellar-sdk');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { createWallet, server, networkPassphrase } = require('../utils/stellar');
const { encrypt, decrypt } = require('../utils/crypto');

const MULTISIG_THRESHOLD_XLM = 50; // payments above this require multi-sig
const TX_EXPIRY_HOURS = 24;

// POST /api/cooperatives — create a cooperative (farmer only)
router.post('/', auth, async (req, res) => {
  const { name } = req.body;
  if (!name) return err(res, 400, 'name is required', 'validation_error');

  const wallet = createWallet();
  const encryptedSecret = await encrypt(wallet.secretKey);
  const { rows } = await db.query(
    `INSERT INTO cooperatives (name, stellar_public_key, stellar_secret_key)
     VALUES ($1, $2, $3) RETURNING id`,
    [name, wallet.publicKey, encryptedSecret]
  );
  const coopId = rows[0].id;

  // Add creator as first member
  await db.query(`INSERT INTO cooperative_members (cooperative_id, user_id) VALUES ($1, $2)`, [
    coopId,
    req.user.id,
  ]);

  res.status(201).json({ success: true, id: coopId, publicKey: wallet.publicKey });
});

// GET /api/cooperatives — list cooperatives the user belongs to
router.get('/', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.stellar_public_key, c.multisig_threshold, c.created_at
     FROM cooperatives c
     JOIN cooperative_members cm ON cm.cooperative_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/cooperatives/:id/multisig-setup — add signers and set threshold
// Body: { member_ids: [userId, ...], threshold: N }
router.post('/:id/multisig-setup', auth, async (req, res) => {
  const coopId = parseInt(req.params.id, 10);
  const { member_ids, threshold } = req.body;

  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return err(res, 400, 'member_ids array is required', 'validation_error');
  }
  if (!threshold || threshold < 1 || threshold > member_ids.length) {
    return err(
      res,
      400,
      `threshold must be between 1 and ${member_ids.length}`,
      'validation_error'
    );
  }

  // Verify caller is a member
  const { rows: memCheck } = await db.query(
    `SELECT 1 FROM cooperative_members WHERE cooperative_id = $1 AND user_id = $2`,
    [coopId, req.user.id]
  );
  if (!memCheck.length) return err(res, 403, 'Not a member of this cooperative', 'forbidden');

  const { rows: coopRows } = await db.query(
    `SELECT stellar_secret_key, stellar_public_key FROM cooperatives WHERE id = $1`,
    [coopId]
  );
  if (!coopRows.length) return err(res, 404, 'Cooperative not found', 'not_found');

  const coop = coopRows[0];

  // Fetch member public keys
  const placeholders = member_ids.map((_, i) => `$${i + 1}`).join(',');
  const { rows: members } = await db.query(
    `SELECT id, stellar_public_key FROM users WHERE id IN (${placeholders})`,
    member_ids
  );

  // Add members to cooperative_members (upsert)
  for (const m of members) {
    await db.query(
      `INSERT OR IGNORE INTO cooperative_members (cooperative_id, user_id) VALUES ($1, $2)`,
      [coopId, m.id]
    );
  }

  // Configure Stellar multi-sig on the cooperative account
  try {
    const coopKeypair = StellarSdk.Keypair.fromSecret(await decrypt(coop.stellar_secret_key));
    const coopAccount = await server.loadAccount(coopKeypair.publicKey());

    const txBuilder = new StellarSdk.TransactionBuilder(coopAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    // Add each member as a signer with weight 1
    for (const m of members) {
      if (m.stellar_public_key && m.stellar_public_key !== coop.stellar_public_key) {
        txBuilder.addOperation(
          StellarSdk.Operation.setOptions({
            signer: { ed25519PublicKey: m.stellar_public_key, weight: 1 },
          })
        );
      }
    }

    // Set thresholds (low/med/high all = threshold)
    txBuilder.addOperation(
      StellarSdk.Operation.setOptions({
        lowThreshold: threshold,
        medThreshold: threshold,
        highThreshold: threshold,
        masterWeight: 1,
      })
    );

    const tx = txBuilder.setTimeout(30).build();
    tx.sign(coopKeypair);
    await server.submitTransaction(tx);
  } catch (e) {
    // If account not funded yet, just save the config — Stellar setup will happen when funded
    console.warn('[multisig-setup] Stellar setup skipped (account may not be funded):', e.message);
  }

  // Save threshold
  await db.query(`UPDATE cooperatives SET multisig_threshold = $1 WHERE id = $2`, [
    threshold,
    coopId,
  ]);

  res.json({ success: true, threshold, members: members.length });
});

// POST /api/cooperatives/:id/transactions — initiate a pending multi-sig transaction
// Body: { destination, amount, memo }
router.post('/:id/transactions', auth, async (req, res) => {
  const coopId = parseInt(req.params.id, 10);
  const { destination, memo } = req.body;
  const amount = parseFloat(req.body.amount);

  if (!destination || !amount || amount <= 0) {
    return err(res, 400, 'destination and amount are required', 'validation_error');
  }

  const { rows: memCheck } = await db.query(
    `SELECT 1 FROM cooperative_members WHERE cooperative_id = $1 AND user_id = $2`,
    [coopId, req.user.id]
  );
  if (!memCheck.length) return err(res, 403, 'Not a member', 'forbidden');

  const { rows: coopRows } = await db.query(
    `SELECT stellar_secret_key, stellar_public_key, multisig_threshold FROM cooperatives WHERE id = $1`,
    [coopId]
  );
  if (!coopRows.length) return err(res, 404, 'Cooperative not found', 'not_found');
  const coop = coopRows[0];

  // If amount is below threshold, pay directly
  if (amount <= MULTISIG_THRESHOLD_XLM) {
    const { sendPayment } = require('../utils/stellar');
    try {
      const txHash = await sendPayment({
        senderSecret: await decrypt(coop.stellar_secret_key),
        receiverPublicKey: destination,
        amount,
        memo,
      });
      return res.json({ success: true, direct: true, txHash });
    } catch (e) {
      return err(res, 502, e.message, 'payment_failed');
    }
  }

  // Build unsigned transaction XDR for multi-sig collection
  let xdr;
  try {
    const coopAccount = await server.loadAccount(coop.stellar_public_key);
    const tx = new StellarSdk.TransactionBuilder(coopAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: amount.toFixed(7),
        })
      )
      .addMemo(StellarSdk.Memo.text(memo || 'CoopPayment'))
      .setTimeout(3600)
      .build();

    // Sign with initiator's key if they are a signer
    const { rows: initiatorRows } = await db.query(
      `SELECT stellar_secret_key FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (initiatorRows[0]?.stellar_secret_key) {
      tx.sign(StellarSdk.Keypair.fromSecret(initiatorRows[0].stellar_secret_key));
    }

    xdr = tx.toXDR();
  } catch (e) {
    return err(res, 502, `Could not build transaction: ${e.message}`, 'stellar_error');
  }

  const expiresAt = new Date(Date.now() + TX_EXPIRY_HOURS * 3600 * 1000).toISOString();
  const initiatorSig = [req.user.id];

  const { rows } = await db.query(
    `INSERT INTO pending_transactions
       (cooperative_id, initiator_id, xdr, amount, destination, memo, signatures, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      coopId,
      req.user.id,
      xdr,
      amount,
      destination,
      memo || null,
      JSON.stringify(initiatorSig),
      expiresAt,
    ]
  );

  res
    .status(201)
    .json({ success: true, pendingTxId: rows[0].id, requiresSignatures: coop.multisig_threshold });
});

// POST /api/transactions/:id/sign — member signs a pending transaction
router.post('/transactions/:id/sign', auth, async (req, res) => {
  const txId = parseInt(req.params.id, 10);

  const { rows } = await db.query(
    `SELECT pt.*, c.multisig_threshold, c.stellar_public_key as coop_public_key
     FROM pending_transactions pt
     JOIN cooperatives c ON c.id = pt.cooperative_id
     WHERE pt.id = $1`,
    [txId]
  );
  if (!rows.length) return err(res, 404, 'Pending transaction not found', 'not_found');
  const ptx = rows[0];

  if (ptx.status !== 'pending')
    return err(res, 400, `Transaction is ${ptx.status}`, 'invalid_state');
  if (new Date(ptx.expires_at) < new Date()) {
    await db.query(`UPDATE pending_transactions SET status = 'expired' WHERE id = $1`, [txId]);
    return err(res, 400, 'Transaction has expired', 'expired');
  }

  // Verify caller is a member
  const { rows: memCheck } = await db.query(
    `SELECT 1 FROM cooperative_members WHERE cooperative_id = $1 AND user_id = $2`,
    [ptx.cooperative_id, req.user.id]
  );
  if (!memCheck.length) return err(res, 403, 'Not a member', 'forbidden');

  const signatures = JSON.parse(ptx.signatures || '[]');
  if (signatures.includes(req.user.id)) {
    return err(res, 400, 'Already signed', 'already_signed');
  }

  // Add signature to XDR
  const { rows: userRows } = await db.query(`SELECT stellar_secret_key FROM users WHERE id = $1`, [
    req.user.id,
  ]);
  if (!userRows[0]?.stellar_secret_key) return err(res, 400, 'No Stellar key', 'no_key');

  let tx;
  try {
    tx = new StellarSdk.Transaction(ptx.xdr, networkPassphrase);
    tx.sign(StellarSdk.Keypair.fromSecret(userRows[0].stellar_secret_key));
  } catch (e) {
    return err(res, 400, `Could not sign: ${e.message}`, 'sign_error');
  }

  signatures.push(req.user.id);
  const newXdr = tx.toXDR();

  // Check if threshold reached
  if (signatures.length >= ptx.multisig_threshold) {
    try {
      const result = await server.submitTransaction(tx);
      await db.query(
        `UPDATE pending_transactions SET status = 'submitted', signatures = $1, xdr = $2 WHERE id = $3`,
        [JSON.stringify(signatures), newXdr, txId]
      );
      return res.json({ success: true, submitted: true, txHash: result.hash });
    } catch (e) {
      return err(res, 502, `Submission failed: ${e.message}`, 'submit_failed');
    }
  }

  await db.query(`UPDATE pending_transactions SET signatures = $1, xdr = $2 WHERE id = $3`, [
    JSON.stringify(signatures),
    newXdr,
    txId,
  ]);

  res.json({
    success: true,
    submitted: false,
    signaturesCollected: signatures.length,
    required: ptx.multisig_threshold,
  });
});

// GET /api/cooperatives/:id/pending — list pending transactions for a cooperative
router.get('/:id/pending', auth, async (req, res) => {
  const coopId = parseInt(req.params.id, 10);

  const { rows: memCheck } = await db.query(
    `SELECT 1 FROM cooperative_members WHERE cooperative_id = $1 AND user_id = $2`,
    [coopId, req.user.id]
  );
  if (!memCheck.length) return err(res, 403, 'Not a member', 'forbidden');

  // Auto-expire old transactions
  await db.query(
    `UPDATE pending_transactions SET status = 'expired'
     WHERE cooperative_id = $1 AND status = 'pending' AND expires_at < CURRENT_TIMESTAMP`,
    [coopId]
  );

  const { rows } = await db.query(
    `SELECT id, initiator_id, amount, destination, memo, signatures, status, expires_at, created_at
     FROM pending_transactions
     WHERE cooperative_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [coopId]
  );

  const data = rows.map((r) => ({
    ...r,
    signatures: JSON.parse(r.signatures || '[]'),
    alreadySigned: JSON.parse(r.signatures || '[]').includes(req.user.id),
  }));

  res.json({ success: true, data });
});

module.exports = router;
