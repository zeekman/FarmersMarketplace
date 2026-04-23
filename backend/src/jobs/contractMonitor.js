/**
 * jobs/contractMonitor.js
 *
 * Polls Soroban contract events every 5 minutes.
 * Detects:
 *   - 3+ failed invocations within the last hour → alert type: failed_invocations
 *   - Any transfer > 1000 XLM                   → alert type: large_transfer
 *
 * Creates a contract_alerts row and emails the admin on each new alert.
 */

const db = require('../db/schema');
const { getContractEvents } = require('../utils/stellar');
const mailer = require('../utils/mailer');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FAILED_INVOCATION_THRESHOLD = 3;
const LARGE_TRANSFER_XLM = 1000;

async function getAdminEmail() {
  const { rows } = await db.query(
    `SELECT email FROM users WHERE role = 'admin' LIMIT 1`
  );
  return rows[0]?.email || null;
}

async function createAlert(contract_id, alert_type, message) {
  // Avoid duplicate alerts: skip if same contract+type alert exists in last 5 min
  const { rows } = await db.query(
    `SELECT id FROM contract_alerts
     WHERE contract_id = $1 AND alert_type = $2
       AND created_at >= datetime('now', '-5 minutes')
     LIMIT 1`,
    [contract_id, alert_type]
  );
  if (rows.length) return null;

  const { rows: inserted } = await db.query(
    `INSERT INTO contract_alerts (contract_id, alert_type, message)
     VALUES ($1, $2, $3) RETURNING *`,
    [contract_id, alert_type, message]
  );

  const adminEmail = await getAdminEmail();
  if (adminEmail) {
    await mailer.sendContractAlert({ to: adminEmail, alert: inserted[0] }).catch((e) =>
      console.error('[ContractMonitor] Email failed:', e.message)
    );
  }

  return inserted[0];
}

async function monitorContract(contractId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  let result;
  try {
    result = await getContractEvents(contractId, { from: oneHourAgo, limit: 200 });
  } catch (err) {
    console.error(`[ContractMonitor] Failed to fetch events for ${contractId}:`, err.message);
    return;
  }

  const events = result.events || [];

  // Detect failed invocations
  const failures = events.filter((e) => {
    const topics = e.topics || [];
    return topics.some(
      (t) => typeof t === 'string' && /fail|error|revert/i.test(t)
    ) || e.type === 'diagnostic';
  });

  if (failures.length >= FAILED_INVOCATION_THRESHOLD) {
    await createAlert(
      contractId,
      'failed_invocations',
      `${failures.length} failed invocations detected in the last hour for contract ${contractId}`
    );
  }

  // Detect large transfers
  for (const ev of events) {
    const topics = ev.topics || [];
    const isTransfer = topics.some(
      (t) => typeof t === 'string' && /transfer/i.test(t)
    );
    if (!isTransfer) continue;

    // data may be the amount (native XLM in stroops or XLM directly)
    let amount = null;
    if (typeof ev.data === 'bigint' || typeof ev.data === 'number') {
      amount = Number(ev.data);
      // If in stroops (1 XLM = 10_000_000 stroops)
      if (amount > 1e10) amount = amount / 1e7;
    } else if (typeof ev.data === 'object' && ev.data !== null) {
      const val = ev.data.amount ?? ev.data.value ?? ev.data;
      amount = typeof val === 'bigint' ? Number(val) / 1e7 : parseFloat(val) || null;
    }

    if (amount !== null && amount > LARGE_TRANSFER_XLM) {
      await createAlert(
        contractId,
        'large_transfer',
        `Large transfer of ${amount.toFixed(2)} XLM detected on contract ${contractId} (ledger ${ev.ledger})`
      );
    }
  }
}

async function runMonitoringJob() {
  try {
    const { rows: contracts } = await db.query(
      `SELECT contract_id FROM contracts_registry`
    );
    await Promise.all(contracts.map((c) => monitorContract(c.contract_id)));
  } catch (err) {
    console.error('[ContractMonitor] Job error:', err.message);
  }
}

function startContractMonitor() {
  console.log('[ContractMonitor] Starting — polling every 5 minutes');
  runMonitoringJob(); // run immediately on startup
  return setInterval(runMonitoringJob, POLL_INTERVAL_MS);
}

module.exports = { startContractMonitor, runMonitoringJob };
