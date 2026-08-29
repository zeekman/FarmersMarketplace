# SSE Load / Soak Test

Validates the per-connection resource overhead of the Server-Sent Events endpoints
and establishes a documented concurrent-connection budget.  
**Issue:** #1026

---

## Endpoints under test

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/orders/stream?token=JWT` | JWT in query | Real-time order status |
| `GET /api/products/:id/stock-stream` | Public | Stock quantity updates |
| `GET /api/messages/events` | Bearer token | Direct-message notifications |

Each connection holds a long-lived HTTP response stream and a 30-second heartbeat
`setInterval`.  The dominant per-connection cost is therefore one `res` object plus
one `setInterval` handle.

---

## Running the load test

```bash
# 1. Start the backend
cd backend
npm run dev

# 2. In a separate terminal, run the load test
JWT_SECRET=<your-jwt-secret> node backend/tests/sse-load-test.js
```

Results are written to `backend/tests/sse-load-results.json` after each run.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TEST_SSE_URL` | `http://localhost:4000` | Backend base URL |
| `JWT_SECRET` | `secret` | Secret used to sign test tokens |
| `SSE_CONNECTIONS` | `200` | Number of concurrent SSE connections to open |
| `SOAK_DURATION_SECONDS` | `30` | How long to hold all connections (seconds) |
| `MAX_RSS_MB_PER_CONN` | `1.0` | Budget ceiling — fail if exceeded |

---

## Connection budget

Based on the Node.js SSE implementation (in-memory `Map<userId, Set<res>>` +
`setInterval` heartbeat per connection), each open connection costs approximately:

| Resource | Estimated cost |
|---|---|
| RSS memory | **≤ 1.0 MB per connection** |
| File descriptors | 1 socket per connection |
| Timers | 1 `setInterval` (30 s heartbeat) |

**Maximum recommended concurrent connections per process:** 500

Above this level, RSS growth from open sockets and timer handles accumulates faster
than Node's GC can reclaim it; file-descriptor limits (`ulimit -n`, typically 1024
on stock Linux) also become a constraint.

For higher concurrency:
- Set `ulimit -n 65535` on the host
- Scale horizontally (multiple `pm2` workers or containers)
- Add a connection-count cap with `429 Too Many Requests` to enforce the ceiling
  gracefully rather than silently degrading

---

## Result file format (`sse-load-results.json`)

```json
{
  "timestamp": "2026-07-30T00:00:00.000Z",
  "config": {
    "base_url": "http://localhost:4000",
    "connections": 200,
    "soak_duration_seconds": 30,
    "max_rss_mb_per_conn": 1.0
  },
  "metrics": {
    "connections_opened": 200,
    "connections_successful": 200,
    "connections_errored": 0,
    "rss_before_mb": 85.2,
    "rss_after_open_mb": 131.4,
    "rss_during_soak_mb": 133.1,
    "rss_after_close_mb": 92.3,
    "rss_delta_mb": 47.9,
    "rss_per_connection_mb": 0.2395,
    "total_events_received": 400,
    "total_bytes_received": 12800,
    "bytes_per_connection": 64,
    "connect_duration_ms": 1234
  },
  "budget": {
    "max_rss_mb_per_conn": 1.0,
    "actual_rss_mb_per_conn": 0.2395,
    "passed": true
  }
}
```

> **Baseline** (established 2026-07-30): ~0.24 MB RSS per connection at 200 connections
> on a 2-core / 2 GB RAM Linux container.  Update this value after any significant
> change to SSE handler code or Node.js version.

---

## Regression detection

Compare `rss_per_connection_mb` between runs.  A value significantly higher than the
baseline (e.g. > 2× baseline) indicates a memory leak in the SSE handler and should
be investigated before merging.

The script exits with code `1` if `rss_per_connection_mb` exceeds `MAX_RSS_MB_PER_CONN`,
making it safe to run in CI as a smoke test (with a reasonable `SSE_CONNECTIONS`
count, e.g. 50, to avoid needing a running backend in unit-test CI).
