const router = require("express").Router();
const StellarSdk = require("@stellar/stellar-sdk");
const db = require("../db/schema");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const {
  isTestnet,
  getBalance,
  getAllBalances,
  getTransactions,
  fundTestnetAccount,
  sendPayment,
  addTrustline,
  removeTrustline,
} = require("../utils/stellar");
const { err } = require("../middleware/error");

const BASE_RESERVE_XLM = 1;

function availableAfterReserve(balance) {
  const available = Number(balance) - BASE_RESERVE_XLM;
  return available > 0 ? available : 0;
}

router.get("/", auth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT stellar_public_key, referral_code FROM users WHERE id = $1",
    [req.user.id],
  );
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { getBalance, getTransactions, fundTestnetAccount, sendPayment, server } = require('../utils/stellar');
const stellar = require('../utils/stellar');
const { getBalance, getAllBalances, getTransactions, fundTestnetAccount, sendPayment, addTrustline, removeTrustline } = stellar;
const { lookupFederationAddress } = stellar;
const { err } = require('../middleware/error');

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Stellar wallet operations
 */

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
 *                 referralCode: { type: string }
 */
// GET /api/wallet
router.get('/', auth, async (req, res) => {
  const { rows } = await db.query('SELECT stellar_public_key, referral_code FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user) return err(res, 404, "User not found", "user_not_found");

  const [balance, balances] = await Promise.all([
    getBalance(user.stellar_public_key),
    getAllBalances(user.stellar_public_key),
  ]);

  res.json({
    success: true,
    publicKey: user.stellar_public_key,
    balance,
    availableBalance: availableAfterReserve(balance),
    baseReserve: BASE_RESERVE_XLM,
    balances,
    referralCode: user.referral_code,
  });
});

router.get("/transactions", auth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT stellar_public_key FROM users WHERE id = $1",
    [req.user.id],
  );
  if (!rows[0]) return err(res, 404, "User not found", "user_not_found");

  const txs = await getTransactions(rows[0].stellar_public_key);

  // Enrich each tx with federation addresses (failures are silently ignored)
  const enriched = await Promise.all(txs.map(async (tx) => {
    const [fromFederation, toFederation] = await Promise.all([
      lookupFederationAddress(tx.from),
      lookupFederationAddress(tx.to),
    ]);
    return {
      ...tx,
      from_federation: fromFederation || null,
      to_federation: toFederation || null,
    };
  }));

  res.json({ success: true, data: enriched });
});

router.post("/fund", auth, async (req, res) => {
  if (!isTestnet)
    return err(res, 400, "Only available on testnet", "testnet_only");

  const { rows } = await db.query(
    "SELECT stellar_public_key FROM users WHERE id = $1",
    [req.user.id],
  );
  if (!rows[0]) return err(res, 404, "User not found", "user_not_found");

  try {
    await fundTestnetAccount(rows[0].stellar_public_key);
    const balance = await getBalance(rows[0].stellar_public_key);
    return res.json({
      success: true,
      message: "Account funded with 10,000 XLM (testnet)",
      balance,
    });
  } catch (e) {
    return err(res, 500, e.message || "Failed to fund account", "fund_failed");
  }
});

router.post("/send", auth, validate.sendXLM, async (req, res) => {
  const { destination, memo } = req.body;
  const amount = parseFloat(req.body.amount);

  const { rows } = await db.query(
    "SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1",
    [req.user.id],
  );
  const user = rows[0];
  if (!user) return err(res, 404, "User not found", "user_not_found");

  if (destination === user.stellar_public_key) {
    return err(
      res,
      400,
      "Cannot send XLM to your own wallet",
      "same_destination",
    );
  }

  const balance = await getBalance(user.stellar_public_key);
  const required = amount + 0.00001;
  if (balance < required) {
    return res.status(402).json({
      success: false,
      error: "Insufficient XLM balance",
      code: "insufficient_balance",
      required: required.toFixed(7),
      available: balance.toFixed(7),
    });
  }

  try {
    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: memo || "",
    });
    return res.json({
      success: true,
      txHash,
      amount,
      destination,
      memo: memo || null,
    });
  } catch (e) {
    const stellarMsg =
      e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    return res
      .status(502)
      .json({
        success: false,
        error: `Stellar transaction failed: ${stellarMsg}`,
      });
  }
});

router.post("/withdraw", auth, async (req, res) => {
  const destination = String(req.body.destination || "").trim();
  const amount = parseFloat(req.body.amount);

  if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) {
    return err(
      res,
      400,
      "Invalid Stellar destination address",
      "invalid_destination",
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return err(res, 400, "Amount must be greater than 0", "invalid_amount");
  }

  const { rows } = await db.query(
    "SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1",
    [req.user.id],
  );
  const user = rows[0];
  if (!user) return err(res, 404, "User not found", "user_not_found");

  if (destination === user.stellar_public_key) {
    return err(
      res,
      400,
      "Cannot withdraw to your own platform wallet",
      "same_destination",
    );
  }

  const balance = await getBalance(user.stellar_public_key);
  const available = availableAfterReserve(balance);

  if (amount > available) {
    return err(
      res,
      400,
      `Insufficient available balance. You must keep ${BASE_RESERVE_XLM} XLM as base reserve.`,
      "insufficient_available_balance",
      {
        available: Number(available.toFixed(7)),
        requested: amount,
        baseReserve: BASE_RESERVE_XLM,
      },
    );
  }

  try {
    const txHash = await sendPayment({
      senderSecret: user.stellar_secret_key,
      receiverPublicKey: destination,
      amount,
      memo: "Wallet withdrawal",
    });

    return res.json({
      success: true,
      txHash,
      type: "withdrawal",
      destination,
      amount,
      baseReserve: BASE_RESERVE_XLM,
      availableAfter: Number((available - amount).toFixed(7)),
    });
  } catch (e) {
    const stellarMsg =
      e?.response?.data?.extras?.result_codes?.operations?.[0] || e.message;
    return res
      .status(502)
      .json({
        success: false,
        error: `Stellar transaction failed: ${stellarMsg}`,
      });
  }
});

router.get("/assets", auth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT stellar_public_key FROM users WHERE id = $1",
    [req.user.id],
  );
  if (!rows[0]) return err(res, 404, "User not found", "user_not_found");

  const balances = await getAllBalances(rows[0].stellar_public_key);
  const assets = balances.filter((b) => b.asset_type !== "native");
  res.json({ success: true, data: assets });
});

router.post("/trustline", auth, async (req, res) => {
  const assetCode = String(req.body.asset_code || "").trim();
  const assetIssuer = String(req.body.asset_issuer || "").trim();
  if (!assetCode || !assetIssuer) {
    return err(
      res,
      400,
      "asset_code and asset_issuer are required",
      "validation_error",
    );
  }

  const { rows } = await db.query(
    "SELECT stellar_secret_key FROM users WHERE id = $1",
    [req.user.id],
  );
  if (!rows[0]) return err(res, 404, "User not found", "user_not_found");

  const txHash = await addTrustline({
    secret: rows[0].stellar_secret_key,
    assetCode,
    assetIssuer,
  });
  res.json({ success: true, txHash });
});

router.delete("/trustline", auth, async (req, res) => {
  const assetCode = String(req.body.asset_code || "").trim();
  const assetIssuer = String(req.body.asset_issuer || "").trim();
  if (!assetCode || !assetIssuer) {
    return err(
      res,
      400,
      "asset_code and asset_issuer are required",
      "validation_error",
    );
  }

  const { rows } = await db.query(
    "SELECT stellar_secret_key FROM users WHERE id = $1",
    [req.user.id],
  );
  if (!rows[0]) return err(res, 404, "User not found", "user_not_found");

  const txHash = await removeTrustline({
    secret: rows[0].stellar_secret_key,
    assetCode,
    assetIssuer,
  });
  res.json({ success: true, txHash });
});

module.exports = router;
