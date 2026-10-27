/**
 * productService.js
 *
 * Shared logic for creating a single product, including all post-create
 * side effects that both the single-create route (POST /products) and the
 * bulk-import pipeline must trigger:
 *
 *   • price_history row
 *   • waitlist / back-in-stock notifications (batched for bulk use)
 *   • SSE stock broadcast
 *   • cache invalidation  ← caller's responsibility after a bulk batch;
 *                           individual creates call it directly.
 */

const db = require('../db/schema');
const cache = require('../cache');
const logger = require('../logger');
const { broadcastStockUpdate } = require('../utils/stockUpdates');
const { sendBackInStockEmail } = require('../utils/mailer');
const { sendPushToUser } = require('../utils/pushNotifications');

const VALID_ALLERGENS = ['gluten', 'nuts', 'dairy', 'eggs', 'soy', 'shellfish'];

/**
 * Insert one product row and record an initial price_history entry.
 * Must be called inside an active transaction/savepoint if you want atomicity
 * across a batch (pass `tx`).  When called standalone pass `db` itself.
 *
 * @param {object} txOrDb   - db handle or active transaction handle
 * @param {number} farmerId
 * @param {object} data     - validated & sanitised product fields
 * @returns {Promise<{id: number}>}
 */
async function insertProduct(txOrDb, farmerId, data) {
  const columns = [
    'farmer_id', 'name', 'description', 'category', 'price', 'quantity', 'unit',
    'allergens', 'min_order_quantity', 'pricing_model', 'min_price',
    'low_stock_threshold', 'weight_kg',
  ];
  const values = [
    farmerId,
    data.name,
    data.description ?? '',
    data.category ?? 'other',
    data.price,
    data.quantity,
    data.unit ?? 'unit',
    data.allergens ?? null,
    data.min_order_quantity ?? 1,
    data.pricing_model ?? 'fixed',
    data.min_price ?? null,
    data.low_stock_threshold ?? 5,
    data.weight_kg ?? 1.0,
  ];

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await txOrDb.query(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  const productId = rows[0].id;

  // Record the initial price in price_history
  await txOrDb.query(
    'INSERT INTO price_history (product_id, price) VALUES ($1, $2)',
    [productId, data.price]
  );

  return { id: productId };
}

/**
 * Fire post-create side effects for a single product.
 * Safe to call outside a transaction – network / push failures are logged
 * but never thrown.
 *
 * @param {number} productId
 * @param {number} quantity
 */
async function firePostCreateEffects(productId, quantity) {
  try {
    broadcastStockUpdate(productId, quantity);
  } catch (e) {
    logger.warn({ err: e, productId }, 'SSE broadcast failed after bulk import');
  }
}

/**
 * Batch post-create side effects: send back-in-stock emails/push for any
 * waitlist entries on newly created products, then invalidate the cache once.
 *
 * Called once after the whole batch commits to avoid N individual cache clears.
 *
 * @param {number[]} productIds
 */
async function fireBatchPostCreateEffects(productIds) {
  if (!productIds.length) return;

  // Cache invalidation – one call covers all new products
  try {
    await cache.delByPattern('products:*');
  } catch (e) {
    logger.warn({ err: e }, 'Cache invalidation failed after bulk import');
  }

  // SSE broadcasts for each new product
  for (const productId of productIds) {
    try {
      // Fetch the quantity we just inserted
      const { rows } = await db.query('SELECT quantity FROM products WHERE id = $1', [productId]);
      if (rows[0]) broadcastStockUpdate(productId, rows[0].quantity);
    } catch (e) {
      logger.warn({ err: e, productId }, 'SSE broadcast failed after bulk import');
    }
  }

  // Waitlist notifications – batch query to avoid N+1
  try {
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: waitlistRows } = await db.query(
      `SELECT w.user_id, w.product_id, p.name, p.quantity
         FROM waitlist w
         JOIN products p ON p.id = w.product_id
        WHERE w.product_id IN (${placeholders})
          AND p.quantity > 0`,
      productIds
    );

    for (const entry of waitlistRows) {
      try {
        const { rows: userRows } = await db.query(
          'SELECT email, name FROM users WHERE id = $1',
          [entry.user_id]
        );
        const user = userRows[0];
        if (!user) continue;

        // Email
        if (sendBackInStockEmail) {
          await sendBackInStockEmail(user.email, user.name, entry.name, entry.product_id).catch(
            (e) => logger.warn({ err: e }, 'Waitlist email failed after bulk import')
          );
        }

        // Push
        if (sendPushToUser) {
          await sendPushToUser(entry.user_id, {
            title: 'Back in stock',
            body: `${entry.name} is now available`,
            url: `/products/${entry.product_id}`,
          }).catch((e) =>
            logger.warn({ err: e }, 'Waitlist push failed after bulk import')
          );
        }
      } catch (e) {
        logger.warn({ err: e, userId: entry.user_id }, 'Waitlist notification failed');
      }
    }
  } catch (e) {
    logger.warn({ err: e }, 'Waitlist query failed after bulk import');
  }
}

/**
 * Validate a raw CSV/JSON row against bulk-import rules.
 *
 * Rules mirror validate.product (validate.js) for the fields present in a
 * CSV row.  Extra strictness:
 *   • price / quantity must parse cleanly to a finite number (no trailing chars)
 *   • price must have at most 7 decimal places (XLM precision)
 *   • price must be finite and ≤ 1e15
 *   • allergens from VALID_ALLERGENS list
 *
 * @param {object} raw   - one CSV/JSON row (all values are strings from CSV)
 * @returns {{ product: object }|{ errors: string[] }}
 */
function validateRow(raw) {
  const errors = [];

  // --- name ---
  const rawName = (raw.name ?? '').trim();
  if (!rawName) errors.push('name is required');

  // --- price ---
  const rawPrice = String(raw.price ?? '').trim();
  const price = Number(rawPrice);
  if (!rawPrice || rawPrice === '') {
    errors.push('price is required');
  } else if (!/^-?\d+(\.\d+)?$/.test(rawPrice) || !Number.isFinite(price)) {
    errors.push(`price "${rawPrice}" is not a valid number`);
  } else if (price <= 0) {
    errors.push('price must be a positive number');
  } else if (price > 1e15) {
    errors.push('price is too large');
  } else {
    // Check at most 7 decimal places (XLM precision)
    const decimalPart = rawPrice.split('.')[1] ?? '';
    if (decimalPart.length > 7) {
      errors.push('price must have at most 7 decimal places');
    }
  }

  // --- quantity ---
  const rawQty = String(raw.quantity ?? '').trim();
  const quantity = Number(rawQty);
  if (!rawQty || rawQty === '') {
    errors.push('quantity is required');
  } else if (!/^\d+$/.test(rawQty) || !Number.isFinite(quantity)) {
    errors.push(`quantity "${rawQty}" must be a whole number`);
  } else if (quantity <= 0) {
    errors.push('quantity must be a positive integer');
  } else if (quantity > (parseInt(process.env.MAX_ORDER_QUANTITY, 10) || 10000)) {
    errors.push(
      `quantity cannot exceed ${parseInt(process.env.MAX_ORDER_QUANTITY, 10) || 10000}`
    );
  }

  // --- allergens ---
  let allergens = null;
  const rawAllergens = raw.allergens;
  if (rawAllergens !== undefined && rawAllergens !== null && rawAllergens !== '') {
    const arr = Array.isArray(rawAllergens)
      ? rawAllergens
      : String(rawAllergens).split(',').map((a) => a.trim()).filter(Boolean);
    const invalid = arr.find((a) => !VALID_ALLERGENS.includes(a));
    if (invalid) {
      errors.push(
        `Invalid allergen: "${invalid}". Must be one of: ${VALID_ALLERGENS.join(', ')}`
      );
    } else {
      allergens = arr.length > 0 ? JSON.stringify(arr) : null;
    }
  }

  if (errors.length) return { errors };

  const { sanitizeText } = require('../utils/sanitize');

  return {
    product: {
      name: sanitizeText(rawName),
      description: sanitizeText((raw.description ?? '').trim()),
      price,
      quantity,
      unit: sanitizeText((raw.unit ?? 'unit').trim()) || 'unit',
      category: sanitizeText((raw.category ?? 'other').trim()) || 'other',
      allergens,
      min_order_quantity: raw.min_order_quantity
        ? parseInt(raw.min_order_quantity, 10) || 1
        : 1,
      pricing_model: raw.pricing_model || 'fixed',
      min_price: raw.min_price ? parseFloat(raw.min_price) || null : null,
      low_stock_threshold: raw.low_stock_threshold
        ? parseInt(raw.low_stock_threshold, 10) || 5
        : 5,
      weight_kg: raw.weight_kg ? parseFloat(raw.weight_kg) || 1.0 : 1.0,
    },
  };
}

module.exports = {
  insertProduct,
  firePostCreateEffects,
  fireBatchPostCreateEffects,
  validateRow,
  VALID_ALLERGENS,
};
