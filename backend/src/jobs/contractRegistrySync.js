'use strict';

/**
 * contractRegistrySync.js
 *
 * Syncs on-chain Soroban contract deployments from Stellar Horizon to contracts_registry.
 *
 * - De-duplicates via ON CONFLICT (contract_id) DO NOTHING.
 * - Persists a high-water mark (last synced ledger) to avoid re-scanning old ledgers.
 * - Retries Horizon API failures with exponential backoff (see REGISTRY_SYNC_RETRY_DELAY_MS).
 *
 * Startup retry / backoff behaviour
 * ----------------------------------
 * If the Horizon endpoint (or Soroban RPC) is unreachable when the job first runs at
 * application startup, `fetchDeployments` will retry up to MAX_RETRIES times with
 * exponential backoff (BASE_RETRY_DELAY_MS * 2^attempt, capped at MAX_BACKOFF_MS).
 * After all retries are exhausted the error is re-thrown from `fetchDeployments`.
 * `runSync` catches that error, logs it, and returns early with zero insertions —
 * the job does NOT crash the process.  The next scheduled run (see startRegistrySync)
 * will attempt again, so a transient provider restart at startup is recovered from
 * automatically within one poll interval (SYNC_INTERVAL_MS).
 */

const db = require('../db/schema');
const { server: horizonServer, isTestnet } = require('../utils/stellar-config');
const logger = require('../logger');

const NETWORK = isTestnet ? 'testnet' : 'mainnet';
const BASE_RETRY_DELAY_MS = parseInt(process.env.REGISTRY_SYNC_RETRY_DELAY_MS || '5000', 10);
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = parseInt(process.env.REGISTRY_SYNC_MAX_BACKOFF_MS || '60000', 10);
const SYNC_INTERVAL_MS = parseInt(process.env.REGISTRY_SYNC_INTERVAL_MS || '300000', 10); // 5 min
const SYNC_LIMIT = 200; // Horizon page size

/**
 * Get the last synced ledger from the high-water mark stored in the DB.
 * Uses a dedicated sync_meta table key.
 * @returns {Promise<number>} ledger sequence (0 if never synced)
 */
async function getHighWaterMark() {
  try {
    const { rows } = await db.query(
      `SELECT value FROM sync_meta WHERE key = 'contracts_registry_last_ledger' LIMIT 1`
    );
    return rows[0] ? parseInt(rows[0].value, 10) : 0;
  } catch {
    // sync_meta table may not exist; treat as first run
    return 0;
  }
}

/**
 * Persist the high-water mark ledger sequence.
 * @param {number} ledger
 */
async function setHighWaterMark(ledger) {
  try {
    await db.query(
      db.isPostgres
        ? `INSERT INTO sync_meta (key, value) VALUES ('contracts_registry_last_ledger', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
        : `INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('contracts_registry_last_ledger', ?)`,
      [String(ledger)]
    );
  } catch (e) {
    logger.warn('[contractRegistrySync] Could not persist high-water mark', { error: e.message });
  }
}

/**
 * Fetch contract deployment operations from Horizon starting after `fromLedger`.
 * Retries up to MAX_RETRIES times with exponential backoff.
 * @param {number} fromLedger
 * @returns {Promise<Array>}
 */
async function fetchDeployments(fromLedger, retryCount = 0) {
  try {
    // Query Horizon for invoke_host_function operations (contract uploads/creates)
    const builder = horizonServer
      .operations()
      .limit(SYNC_LIMIT)
      .order('asc');

    if (fromLedger > 0) {
      // Cursor format for Horizon: ledger * 4096 + operation index base
      builder.cursor(String(fromLedger * 4096));
    }

    const response = await builder.call();
    const records = (response?.records || []).filter(
      (op) => op.type === 'invoke_host_function'
    );
    return records;
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS);
      logger.warn('[contractRegistrySync] Horizon API error, retrying', {
        error: err.message, retryCount, delay,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchDeployments(fromLedger, retryCount + 1);
    }
    // All retries exhausted — re-throw so runSync can handle gracefully
    throw err;
  }
}

/**
 * Run one sync pass: fetch new deployments since last ledger, insert with ON CONFLICT DO NOTHING.
 * @returns {Promise<{inserted: number, skipped: number, lastLedger: number}>}
 */
async function runSync() {
  const fromLedger = await getHighWaterMark();
  logger.info('[contractRegistrySync] Starting sync', { fromLedger });

  let records;
  try {
    records = await fetchDeployments(fromLedger);
  } catch (err) {
    logger.error('[contractRegistrySync] Failed to fetch deployments from Horizon', { error: err.message });
    return { inserted: 0, skipped: 0, lastLedger: fromLedger };
  }

  if (records.length === 0) {
    logger.info('[contractRegistrySync] No new deployments found');
    return { inserted: 0, skipped: 0, lastLedger: fromLedger };
  }

  let inserted = 0;
  let skipped = 0;
  let maxLedger = fromLedger;

  for (const op of records) {
    const contractId = op.contract_id || op.contractId || null;
    if (!contractId) continue;

    const ledger = op.transaction?.ledger_attr || op.ledger_attr || 0;
    if (ledger > maxLedger) maxLedger = ledger;

    try {
      const result = await db.query(
        db.isPostgres
          ? `INSERT INTO contracts_registry (contract_id, name, type, network, deployed_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (contract_id) DO NOTHING`
          : `INSERT OR IGNORE INTO contracts_registry (contract_id, name, type, network, deployed_at)
             VALUES (?, ?, ?, ?, ?)`,
        [
          contractId,
          contractId, // name defaults to contract_id until enriched
          'other',
          NETWORK,
          op.created_at || new Date().toISOString(),
        ]
      );

      const affected = db.isPostgres ? result.rowCount : result.changes;
      if (affected > 0) {
        inserted++;
        logger.info('[contractRegistrySync] Inserted contract', { contractId });
      } else {
        skipped++;
      }
    } catch (err) {
      logger.error('[contractRegistrySync] Insert failed for contract', { contractId, error: err.message });
      skipped++;
    }
  }

  if (maxLedger > fromLedger) {
    await setHighWaterMark(maxLedger);
  }

  logger.info('[contractRegistrySync] Sync complete', { inserted, skipped, lastLedger: maxLedger });
  return { inserted, skipped, lastLedger: maxLedger };
}

/**
 * Start the periodic registry sync job.
 * Runs an initial sync immediately on startup (with retry/backoff built into
 * fetchDeployments), then repeats on SYNC_INTERVAL_MS.  A failure during the
 * startup run is caught and logged — it does not crash the process.
 * @returns {NodeJS.Timeout} interval handle (call clearInterval to stop)
 */
function startRegistrySync() {
  logger.info('[contractRegistrySync] Starting — sync interval every ' + SYNC_INTERVAL_MS + 'ms');
  runSync().catch((err) =>
    logger.error('[contractRegistrySync] Startup sync failed after all retries', { error: err.message })
  );
  return setInterval(() => {
    runSync().catch((err) =>
      logger.error('[contractRegistrySync] Scheduled sync failed', { error: err.message })
    );
  }, SYNC_INTERVAL_MS);
}

module.exports = { runSync, getHighWaterMark, setHighWaterMark, fetchDeployments, startRegistrySync };
