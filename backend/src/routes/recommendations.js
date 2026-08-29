const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const cache = require('../cache');

const CACHE_TTL = 15 * 60; // 15 minutes

/**
 * GET /api/recommendations?limit=N
 * Authenticated buyers only.
 * - Personalised: products from same categories as past orders, excluding already-purchased.
 * - Cold-start: top products by avg_rating DESC, view_count DESC.
 * Ranked: category match → high avg_rating → recency.
 * Max limit 20, default 12.
 */
router.get('/', auth, async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const userId = req.user.id;
  const cacheKey = `recommendations:${userId}:${limit}`;

  const cached = await cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  // Check if user has any completed orders
  const { rows: orderRows } = await db.query(
    `SELECT DISTINCT p.category
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.buyer_id = $1 AND o.status = 'completed'`,
    [userId]
  );

  let products;

  if (orderRows.length === 0) {
    // Cold-start: top by avg_rating DESC, view_count DESC
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.category, p.price, p.quantity, p.unit,
              p.avg_rating, p.view_count, p.created_at,
              u.name AS farmer_name
       FROM products p
       JOIN users u ON p.farmer_id = u.id
       WHERE p.quantity > 0
       ORDER BY p.avg_rating DESC, p.view_count DESC
       LIMIT $1`,
      [limit]
    );
    products = rows;
  } else {
    const categories = orderRows.map((r) => r.category).filter(Boolean);

    // Get already-purchased product ids
    const { rows: purchasedRows } = await db.query(
      `SELECT DISTINCT product_id FROM orders WHERE buyer_id = $1`,
      [userId]
    );
    const purchasedIds = purchasedRows.map((r) => r.product_id);

    // Build exclusion clause
    const excludeClause =
      purchasedIds.length > 0
        ? `AND p.id NOT IN (${purchasedIds.map((_, i) => `$${i + 3}`).join(',')})`
        : '';

    const catPlaceholders = categories.map((_, i) => `$${i + 1}`).join(',');
    const params = [
      ...categories,
      limit,
      ...purchasedIds,
    ];

    const { rows } = await db.query(
      `SELECT p.id, p.name, p.category, p.price, p.quantity, p.unit,
              p.avg_rating, p.view_count, p.created_at,
              u.name AS farmer_name,
              CASE WHEN p.category IN (${catPlaceholders}) THEN 1 ELSE 0 END AS cat_match
       FROM products p
       JOIN users u ON p.farmer_id = u.id
       WHERE p.quantity > 0
         AND p.category IN (${catPlaceholders})
         ${excludeClause}
       ORDER BY cat_match DESC, p.avg_rating DESC, p.created_at DESC
       LIMIT $${categories.length + 1}`,
      params
    );
    products = rows;

    // If we got fewer than limit from categories, fill with cold-start
    if (products.length < limit) {
      const remaining = limit - products.length;
      const existingIds = [...purchasedIds, ...products.map((p) => p.id)];
      const excludeIds =
        existingIds.length > 0
          ? `AND p.id NOT IN (${existingIds.map((_, i) => `$${i + 1}`).join(',')})`
          : '';
      const { rows: fill = [] } = await db.query(
        `SELECT p.id, p.name, p.category, p.price, p.quantity, p.unit,
                p.avg_rating, p.view_count, p.created_at,
                u.name AS farmer_name, 0 AS cat_match
         FROM products p
         JOIN users u ON p.farmer_id = u.id
         WHERE p.quantity > 0 ${excludeIds}
         ORDER BY p.avg_rating DESC, p.view_count DESC
         LIMIT $${existingIds.length + 1}`,
        [...existingIds, remaining]
      );
      products = [...products, ...fill];
    }
  }

  await cache.set(cacheKey, products, CACHE_TTL);
  res.json({ success: true, data: products });
});

module.exports = router;
