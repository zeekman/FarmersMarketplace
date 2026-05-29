'use strict';

const cron = require('node-cron');
const db = require('../db/schema');
const logger = require('../logger');

/**
 * Returns the ISO date string (YYYY-MM-DD) for a given Date, defaulting to yesterday.
 * Accepting an explicit date makes the function testable without time-travel.
 */
function targetDate(d = new Date()) {
  const dt = new Date(d);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Aggregate product_views for a single date into product_view_summaries.
 *
 * Idempotent: uses INSERT … ON CONFLICT DO UPDATE (PG) / INSERT OR REPLACE (SQLite)
 * so reruns for the same date safely overwrite stale data.
 *
 * Batching: processes products in chunks of BATCH_SIZE to avoid full-table scans
 * and keep memory usage bounded on large datasets.
 *
 * @param {string} [date] - ISO date string YYYY-MM-DD; defaults to yesterday.
 * @returns {Promise<{date: string, processed: number, skipped: number}>}
 */
async function aggregateProductViews(date) {
  const aggDate = date || targetDate();
  const BATCH_SIZE = parseInt(process.env.VIEWS_AGG_BATCH_SIZE || '500', 10);

  logger.info('[product-views-agg] Starting aggregation', { date: aggDate });

  // Fetch distinct product IDs that have views on the target date.
  // Using a targeted date-range query avoids a full scan of product_views.
  let productIds;
  if (db.isPostgres) {
    const { rows } = await db.query(
      `SELECT DISTINCT product_id
       FROM product_views
       WHERE viewed_at >= $1::date AND viewed_at < ($1::date + INTERVAL '1 day')`,
      [aggDate]
    );
    productIds = rows.map((r) => r.product_id);
  } else {
    productIds = db
      .prepare(
        `SELECT DISTINCT product_id
         FROM product_views
         WHERE date(viewed_at) = ?`
      )
      .all(aggDate)
      .map((r) => r.product_id);
  }

  if (productIds.length === 0) {
    logger.info('[product-views-agg] No views found, nothing to aggregate', { date: aggDate });
    return { date: aggDate, processed: 0, skipped: 0 };
  }

  logger.info('[product-views-agg] Products to aggregate', {
    date: aggDate,
    count: productIds.length,
  });

  let processed = 0;
  let skipped = 0;

  // Process in batches to keep memory bounded
  for (let offset = 0; offset < productIds.length; offset += BATCH_SIZE) {
    const batch = productIds.slice(offset, offset + BATCH_SIZE);

    try {
      await aggregateBatch(batch, aggDate);
      processed += batch.length;
    } catch (err) {
      logger.error('[product-views-agg] Batch failed, skipping', {
        date: aggDate,
        batchOffset: offset,
        batchSize: batch.length,
        error: err.message,
      });
      skipped += batch.length;
    }
  }

  logger.info('[product-views-agg] Aggregation complete', { date: aggDate, processed, skipped });
  return { date: aggDate, processed, skipped };
}

/**
 * Aggregate a batch of product IDs for the given date and upsert into the summary table.
 * Wrapped in a transaction so a partial batch failure leaves no partial writes.
 */
async function aggregateBatch(productIds, aggDate) {
  if (db.isPostgres) {
    // Build a single query that aggregates all products in the batch at once,
    // then upserts the results.
    const placeholders = productIds.map((_, i) => `$${i + 2}`).join(', ');
    await db.query(
      `INSERT INTO product_view_summaries (product_id, view_date, view_count, unique_viewers, aggregated_at)
       SELECT product_id,
              $1::date                                AS view_date,
              COUNT(*)                                AS view_count,
              COUNT(DISTINCT COALESCE(user_id, -id))  AS unique_viewers,
              NOW()                                   AS aggregated_at
       FROM product_views
       WHERE viewed_at >= $1::date
         AND viewed_at < ($1::date + INTERVAL '1 day')
         AND product_id IN (${placeholders})
       GROUP BY product_id
       ON CONFLICT (product_id, view_date)
       DO UPDATE SET
         view_count     = EXCLUDED.view_count,
         unique_viewers = EXCLUDED.unique_viewers,
         aggregated_at  = EXCLUDED.aggregated_at`,
      [aggDate, ...productIds]
    );
  } else {
    // SQLite: use a transaction with individual INSERT OR REPLACE per product
    // to stay within parameter limits and keep the logic simple.
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO product_view_summaries
         (product_id, view_date, view_count, unique_viewers, aggregated_at)
       SELECT product_id,
              date(?) AS view_date,
              COUNT(*) AS view_count,
              COUNT(DISTINCT COALESCE(user_id, -id)) AS unique_viewers,
              datetime('now') AS aggregated_at
       FROM product_views
       WHERE date(viewed_at) = ? AND product_id = ?
       GROUP BY product_id`
    );

    db.transaction(() => {
      for (const pid of productIds) {
        upsert.run(aggDate, aggDate, pid);
      }
    })();
  }
}

function startProductViewsAggJob() {
  // Run daily at 01:00 UTC (after midnight, after the backup job at 00:00)
  cron.schedule('0 1 * * *', () => {
    aggregateProductViews().catch((e) =>
      logger.error('[product-views-agg] Job error', { message: e.message })
    );
  });
  logger.info('[product-views-agg] Cron job scheduled (daily at 01:00 UTC)');
}

module.exports = { startProductViewsAggJob, aggregateProductViews, targetDate };
