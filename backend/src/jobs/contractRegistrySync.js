'use strict';

/**
 * contractRegistrySync.js
 *
 * Syncs on-chain Soroban contract deployments from Stellar Horizon to contracts_registry.
 *
 * - De-duplicates via ON CONFLICT (contract_id) DO NOTHING.
 * - Persists a high-water mark (last synced ledger) to avoid re-scanning old ledgers.
 * - Retries Horizon API failures after REGISTRY_SYNC_RETRY_DELAY_MS with exponential backoff.
 */

const db = require('../db/schema');
const { server: horizonServer, isTestnet } = require('../utils/stellar-config');
const logger = require('../logger');

const NETWORK = isTestnet ? 'testnet' : 'mainnet';
const BASE_RETRY_DELAY_MS = parseInt(process.env.REGISTRY_SYNC_RETRY_DELAY_MS || '5000', 10);
const MAX_RETRIES = 3;
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
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
      logger.warn('[contractRegistrySync] Horizon API error, retrying', {
        error: err.message, retryCount, delay,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchDeployments(fromLedger, retryCount + 1);
    }
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

module.exports = { runSync, getHighWaterMark, setHighWaterMark, fetchDeployments };
