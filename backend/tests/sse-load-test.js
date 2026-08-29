#!/usr/bin/env node
'use strict';

/**
 * SSE Load / Soak Test (#1026)
 *
 * Opens N concurrent SSE connections to the orders/stream endpoint,
 * holds them for SOAK_DURATION_SECONDS, then measures per-connection
 * resource overhead (RSS memory, events received).
 *
 * Usage:
 *   node backend/tests/sse-load-test.js
 *
 * Environment variables:
 *   TEST_SSE_URL          Base URL of a running backend   (default: http://localhost:4000)
 *   JWT_SECRET            Secret used to sign test tokens  (default: secret)
 *   SSE_CONNECTIONS       Number of concurrent connections (default: 200)
 *   SOAK_DURATION_SECONDS Hold connections for this long   (default: 30)
 *   MAX_RSS_MB_PER_CONN   Budget ceiling in MB per conn    (default: 1.0)
 *
 * Results are written to: backend/tests/sse-load-results.json
 *
 * Exit codes:
 *   0  — all connections opened; per-connection RSS within budget
 *   1  — budget exceeded or connection errors
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// ─── Configuration ────────────────────────────────────────────────────────

const BASE_URL       = process.env.TEST_SSE_URL          || 'http://localhost:4000';
const JWT_SECRET     = process.env.JWT_SECRET             || 'secret';
const N_CONNECTIONS  = parseInt(process.env.SSE_CONNECTIONS       || '200', 10);
const SOAK_SECS      = parseInt(process.env.SOAK_DURATION_SECONDS || '30',  10);
const MAX_MB_PER_CONN = parseFloat(process.env.MAX_RSS_MB_PER_CONN || '1.0');

const RESULTS_PATH = path.join(__dirname, 'sse-load-results.json');

// ─── Helpers ──────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[sse-load] ${msg}\n`);
}

function rssMb() {
  return process.memoryUsage().rss / 1024 / 1024;
}

function makeToken(userId) {
  return jwt.sign({ id: userId, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Open a single SSE connection and keep it alive until abort() is called.
 * Returns a Promise that resolves to a connection stat object when closed.
 */
function openConnection(id) {
  return new Promise((resolve) => {
    const token = makeToken(id);
    const url = new URL(`/api/orders/stream?token=${encodeURIComponent(token)}`, BASE_URL);
    const transport = url.protocol === 'https:' ? https : http;

    const start = Date.now();
    let eventsReceived = 0;
    let bytesReceived = 0;
    let errorMsg = null;
    let req;

    const cleanup = () => {
      if (req) {
        try { req.destroy(); } catch (_) {}
      }
      resolve({
        id,
        durationMs: Date.now() - start,
        eventsReceived,
        bytesReceived,
        error: errorMsg,
      });
    };

    try {
      req = transport.get(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          headers: { Accept: 'text/event-stream' },
          timeout: (SOAK_SECS + 10) * 1000,
        },
        (resp) => {
          if (resp.statusCode !== 200) {
            errorMsg = `HTTP ${resp.statusCode}`;
            resp.resume();
            cleanup();
            return;
          }
          resp.on('data', (chunk) => {
            bytesReceived += chunk.length;
            const text = chunk.toString();
            eventsReceived += (text.match(/^data:/gm) || []).length;
          });
          resp.on('end', cleanup);
          resp.on('error', (e) => { errorMsg = e.message; cleanup(); });
        }
      );

      req.on('error', (e) => { errorMsg = e.message; cleanup(); });
    } catch (e) {
      errorMsg = e.message;
      cleanup();
    }

    // Store cleanup so the caller can close the connection
    openConnection._cleanups = openConnection._cleanups || new Map();
    openConnection._cleanups.set(id, cleanup);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  log(`Target:      ${BASE_URL}`);
  log(`Connections: ${N_CONNECTIONS}`);
  log(`Soak:        ${SOAK_SECS}s`);
  log(`Budget:      ${MAX_MB_PER_CONN} MB RSS / connection`);
  log('');

  // Probe: check backend is reachable
  try {
    await new Promise((res, rej) => {
      const url = new URL('/api/health', BASE_URL);
      const transport = url.protocol === 'https:' ? https : http;
      transport.get(url.toString(), (r) => { r.resume(); res(); }).on('error', rej);
    });
    log('Backend reachable ✓');
  } catch (e) {
    log(`ERROR: Backend not reachable at ${BASE_URL}: ${e.message}`);
    log('Start the backend first: cd backend && npm run dev');
    process.exit(1);
  }

  const rssBefore = rssMb();
  log(`RSS before connections: ${rssBefore.toFixed(1)} MB`);

  // Open all connections
  log(`Opening ${N_CONNECTIONS} SSE connections...`);
  const connectStart = Date.now();
  openConnection._cleanups = new Map();

  const connectionPromises = Array.from({ length: N_CONNECTIONS }, (_, i) =>
    openConnection(i + 1)
  );

  // Brief pause to let connections stabilise
  await new Promise((r) => setTimeout(r, 2000));

  const rssAfterOpen = rssMb();
  const connectMs = Date.now() - connectStart;
  log(`All connections opened in ${connectMs}ms`);
  log(`RSS after open: ${rssAfterOpen.toFixed(1)} MB (Δ ${(rssAfterOpen - rssBefore).toFixed(1)} MB)`);

  // Soak phase
  log(`Soaking for ${SOAK_SECS}s...`);
  await new Promise((r) => setTimeout(r, SOAK_SECS * 1000));

  const rssDuringSoak = rssMb();
  log(`RSS during soak: ${rssDuringSoak.toFixed(1)} MB`);

  // Close all connections
  log('Closing connections...');
  for (const cleanup of openConnection._cleanups.values()) cleanup();

  const stats = await Promise.all(connectionPromises);
  const rssAfterClose = rssMb();
  log(`RSS after close: ${rssAfterClose.toFixed(1)} MB`);

  // ─── Metrics ────────────────────────────────────────────────────────────

  const errorCount = stats.filter((s) => s.error).length;
  const successCount = stats.length - errorCount;
  const totalBytes = stats.reduce((s, c) => s + c.bytesReceived, 0);
  const totalEvents = stats.reduce((s, c) => s + c.eventsReceived, 0);

  const rssDelta = rssDuringSoak - rssBefore;
  const rssPerConn = successCount > 0 ? rssDelta / successCount : 0;

  const results = {
    timestamp: new Date().toISOString(),
    config: {
      base_url: BASE_URL,
      connections: N_CONNECTIONS,
      soak_duration_seconds: SOAK_SECS,
      max_rss_mb_per_conn: MAX_MB_PER_CONN,
    },
    metrics: {
      connections_opened: N_CONNECTIONS,
      connections_successful: successCount,
      connections_errored: errorCount,
      rss_before_mb: parseFloat(rssBefore.toFixed(2)),
      rss_after_open_mb: parseFloat(rssAfterOpen.toFixed(2)),
      rss_during_soak_mb: parseFloat(rssDuringSoak.toFixed(2)),
      rss_after_close_mb: parseFloat(rssAfterClose.toFixed(2)),
      rss_delta_mb: parseFloat(rssDelta.toFixed(2)),
      rss_per_connection_mb: parseFloat(rssPerConn.toFixed(4)),
      total_events_received: totalEvents,
      total_bytes_received: totalBytes,
      bytes_per_connection: successCount > 0 ? Math.round(totalBytes / successCount) : 0,
      connect_duration_ms: connectMs,
    },
    budget: {
      max_rss_mb_per_conn: MAX_MB_PER_CONN,
      actual_rss_mb_per_conn: parseFloat(rssPerConn.toFixed(4)),
      passed: rssPerConn <= MAX_MB_PER_CONN,
    },
    error_sample: stats
      .filter((s) => s.error)
      .slice(0, 5)
      .map((s) => ({ id: s.id, error: s.error })),
  };

  // Write results file
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  log(`\nResults written to ${RESULTS_PATH}`);

  // ─── Summary ────────────────────────────────────────────────────────────

  log('');
  log('═══ RESULTS ═══');
  log(`Connections:        ${successCount}/${N_CONNECTIONS} successful`);
  log(`RSS delta:          ${rssDelta.toFixed(1)} MB for ${successCount} connections`);
  log(`RSS per connection: ${rssPerConn.toFixed(3)} MB  (budget: ${MAX_MB_PER_CONN} MB)`);
  log(`Total events:       ${totalEvents}`);
  log(`Errors:             ${errorCount}`);

  if (errorCount > 0) {
    log('\nError sample:');
    results.error_sample.forEach((e) => log(`  conn ${e.id}: ${e.error}`));
  }

  if (!results.budget.passed) {
    log(`\n⚠  BUDGET EXCEEDED: ${rssPerConn.toFixed(3)} MB/conn > ${MAX_MB_PER_CONN} MB/conn`);
    log('   Reduce SSE_CONNECTIONS or investigate memory growth per connection.');
    process.exit(1);
  }

  log(`\n✓  PASS: per-connection RSS within ${MAX_MB_PER_CONN} MB budget`);
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
