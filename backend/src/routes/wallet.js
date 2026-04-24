const router = require('express').Router();
const StellarSdk = require('@stellar/stellar-sdk');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const cache = require('../cache');
const {
  isTestnet,
  getBalance,
  getAllBalances,
  getTransactions,
  fundTestnetAccount,
  sendPayment,
  addTrustline,
  removeTrustline,
  mergeAccount,
  lookupFederationAddress,
} = require('../utils/stellar');
const { err } = require('../middleware/error');

const BASE_RESERVE_XLM = 1;

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Stellar wallet operations
 */

function availableAfterReserve(balance) {
  const available = Number(balance) - BASE_RESERVE_XLM;
  return available > 0 ? available : 0;
}

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     summary: Get wallet balance and public key
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 publicKey: { type: string }
 *                 balance: { type: number, description: XLM balance }
 *                 availableBalance: { type: number }
 *                 baseReserve: { type: number }
 *                 balances: { type: array }
 *                 referralCode: { type: string }
 */
router.get('/', auth, async (req, res) => {
  const cacheKey = `wallet:${req.user.id}`;
  const cached = await cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { rows } = await db.query(
      'SELECT stellar_public_key, referral_code FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return err(res, 404, 'User not found', 'user_not_found');

    const [balance, balances] = await Promise.all([
      getBalance(user.stellar_public_key),
      getAllBalances(user.stellar_public_key),
    ]);

    const payload = {
      success: true,
      publicKey: user.stellar_public_key,
      balance,
      availableBalance: availableAfterReserve(balance),
      baseReserve: BASE_RESERVE_XLM,
      balances,
      referralCode: user.referral_code,
    };
    await cache.set(cacheKey, payload, 30);
    return res.json(payload);
  } catch (e) {
    return err(res, 500, e.message, 'wallet_error');
  }
});

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get recent transactions
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *         description: Horizon paging token for cursor-based pagination
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *         description: Number of transactions to return (max 200)
 *     responses:
 *       200:
 *         description: Transaction list with pagination cursors
 */
router.get('/transactions', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (!rows[0]) return err(res, 404, 'User not found', 'user_not_found');

    const cursor = req.query.cursor || undefined;
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 200);

    const { records, next_cursor, prev_cursor } = await getTransactions(
      rows[0].stellar_public_key,
      { cursor, limit }
    );

    // Enrich each tx with federation addresses (failures are silently ignored)
    const enriched = await Promise.all(
      records.map(async (tx) => {
        const [fromFederation, toFederation] = await Promise.all([
          lookupFederationAddress(tx.from),
          lookupFederationAddress(tx.to),
        ]);
        return {
          ...tx,
          from_federation: fromFederation || null,
          to_federation: toFederation || null,
        };
      })
    );

    res.json({ success: true, data: enriched, next_cursor, prev_cursor });
  } catch (e) {
    return err(res, 500, e.message, 'transactions_error');
  }
});

/**
 * @swagger
 * /api/wallet/fund:
 *   post:
 *     summary: Fund testnet account (Stellar Friendbot)
 *     tags: [Wallet]
 */
router.post('/fund', auth, async (req, res) => {
  if (!isTestnet) return err(res, 400, 'Only available on testnet', 'testnet_only');

  const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [
    req.user.id,
  ]);
  if (!rows[0]) return err(res, 404, 'User not found', 'user_not_found');

  try {
    await fundTestnetAccount(rows[0].stellar_public_key);
    await cache.del(`wallet:${req.user.id}`);
    const balance = await getBalance(rows[0].stellar_public_key);
    return res.json({
      success: true,
      message: 'Account funded with 10,000 XLM (testnet)',
      balance,
    });
  } catch (e) {
    return err(res, 500, e.message || 'Failed to fund account', 'fund_failed');
  }
});

/**
 * @swagger
 * /api/wallet/send:
 *   post:
 *     summary: Send XLM to another address
 *     tags: [Wallet]
 */
router.post('/send', auth, validate.sendXLM, async (req, res) => {
  const { destination, memo } = req.body;
  const amount = parseFloat(req.body.amount);

  if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) {
    return err(res, 400, 'Invalid Stellar destination address', 'invalid_destination');
  }

  try {
    const { rows } = await db.query(
      'SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return err(res, 404, 'User not found', 'user_not_found');

    if (destination === user.stellar_public_key) {
      return err(res, 400, 'Cannot send XLM to your own wallet', 'same_destination');
    }

    const balance = await getBalance(user.stellar_public_key);
    const required = amount + 0.00001; // basic fee estimate
    if (balance < required) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient XLM balance',
        code: 'insufficient_balance',
        required: required.toFixed(7),
        available: balance.toFixed(7),
      });
    }

    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: memo || '',
    });

    return res.json({
      success: true,
      txHash,
      amount,
      destination,
      memo: memo || null,
    });
  } catch (e) {
    const stellarMsg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    return res.status(502).json({
      success: false,
      error: `Stellar transaction failed: ${stellarMsg}`,
    });
  }
});

/**
 * @swagger
 * /api/wallet/withdraw:
 *   post:
 *     summary: Withdraw XLM to external address
 *     tags: [Wallet]
 */
router.post('/withdraw', auth, async (req, res) => {
  const destination = String(req.body.destination || '').trim();
  const amount = parseFloat(req.body.amount);

  if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) {
    return err(res, 400, 'Invalid Stellar destination address', 'invalid_destination');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return err(res, 400, 'Amount must be greater than 0', 'invalid_amount');
  }

  try {
    const { rows } = await db.query(
      'SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return err(res, 404, 'User not found', 'user_not_found');

    if (destination === user.stellar_public_key) {
      return err(res, 400, 'Cannot withdraw to your own platform wallet', 'same_destination');
    }

    const balance = await getBalance(user.stellar_public_key);
    const available = availableAfterReserve(balance);

    if (amount > available) {
      return err(
        res,
        400,
        `Insufficient available balance. You must keep ${BASE_RESERVE_XLM} XLM as base reserve.`,
        'insufficient_available_balance',
        {
          available: Number(available.toFixed(7)),
          requested: amount,
          baseReserve: BASE_RESERVE_XLM,
        }
      );
    }

    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: 'Wallet withdrawal',
    });

    return res.json({
      success: true,
      txHash,
      type: 'withdrawal',
      destination,
      amount,
      baseReserve: BASE_RESERVE_XLM,
      availableAfter: Number((available - amount).toFixed(7)),
    });
  } catch (e) {
    const stellarMsg = e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    return res.status(502).json({
      success: false,
      error: `Stellar transaction failed: ${stellarMsg}`,
    });
  }
});

/**
 * @swagger
 * /api/wallet/assets:
 *   get:
 *     summary: Get all assets (trustlines) for wallet
 *     tags: [Wallet]
 */
router.get('/assets', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT stellar_public_key FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (!rows[0]) return err(res, 404, 'User not found', 'user_not_found');

    const balances = await getAllBalances(rows[0].stellar_public_key);
    const assets = balances.filter((b) => b.asset_type !== 'native');
    res.json({ success: true, data: assets });
  } catch (e) {
    return err(res, 500, e.message, 'assets_error');
  }
});

/**
 * @swagger
 * /api/wallet/trustline:
 *   post:
 *     summary: Add a trustline for an asset
 *     tags: [Wallet]
 */
router.post('/trustline', auth, async (req, res) => {
  const assetCode = String(req.body.asset_code || '').trim();
  const assetIssuer = String(req.body.asset_issuer || '').trim();
  if (!assetCode || !assetIssuer) {
    return err(res, 400, 'asset_code and asset_issuer are required', 'validation_error');
  }

  try {
    const { rows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (!rows[0]) return err(res, 404, 'User not found', 'user_not_found');

    const txHash = await addTrustline({
      secret: rows[0].stellar_secret_key,
      assetCode,
      assetIssuer,
    });
    res.json({ success: true, txHash });
  } catch (e) {
    return err(res, 500, e.message, 'trustline_error');
  }
});

/**
 * @swagger
 * /api/wallet/trustline:
 *   delete:
 *     summary: Remove a trustline
 *     tags: [Wallet]
 */
router.delete('/trustline', auth, async (req, res) => {
  const assetCode = String(req.body.asset_code || '').trim();
  const assetIssuer = String(req.body.asset_issuer || '').trim();
  if (!assetCode || !assetIssuer) {
    return err(res, 400, 'asset_code and asset_issuer are required', 'validation_error');
  }

  try {
    const { rows } = await db.query('SELECT stellar_secret_key FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (!rows[0]) return err(res, 404, 'User not found', 'user_not_found');

    const txHash = await removeTrustline({
      secret: rows[0].stellar_secret_key,
      assetCode,
      assetIssuer,
    });
    res.json({ success: true, txHash });
  } catch (e) {
    return err(res, 500, e.message, 'trustline_error');
  }
});

router.post('/merge', auth, async (req, res) => {
  const destination = String(req.body.destination || '').trim();
  const password = String(req.body.password || '').trim();

  if (!destination) {
    return err(res, 400, 'destination is required', 'validation_error');
  }
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) {
    return err(res, 400, 'Invalid destination address', 'invalid_destination');
  }
  if (!password) {
    return err(res, 400, 'password is required', 'validation_error');
  }

  const bcrypt = require('bcryptjs');
  const { rows } = await db.query(
    'SELECT stellar_public_key, stellar_secret_key, password_hash FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = rows[0];
  if (!user) return err(res, 404, 'User not found', 'user_not_found');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return err(res, 401, 'Incorrect password', 'invalid_password');

  if (destination === user.stellar_public_key) {
    return err(res, 400, 'Cannot merge account into itself', 'same_destination');
  }

  try {
    const txHash = await mergeAccount({
      sourceSecret: user.stellar_secret_key,
      destinationPublicKey: destination,
    });

    await db.query(
      'UPDATE users SET stellar_public_key = $1, stellar_secret_key = NULL WHERE id = $2',
      [destination, req.user.id]
    );

    return res.json({ success: true, txHash, destination });
  } catch (e) {
    if (e.code === 'destination_not_found') {
      return err(res, 400, e.message, 'destination_not_found');
    }
    const stellarMsg =
      e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    return res.status(502).json({
      success: false,
      error: `Stellar transaction failed: ${stellarMsg}`,
    });
  }
});

module.exports = router;
