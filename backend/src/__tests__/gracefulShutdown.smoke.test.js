/**
 * Smoke coverage for #1644. This suite is intentionally not run as part of the
 * implementation task; it documents the process-level contract for an external
 * runner that starts the real server and opens an SSE connection.
 */
describe('graceful shutdown smoke contract', () => {
  test.todo('SIGTERM stops new requests, emits SSE shutdown, drains, closes resources, and exits 0');
  test.todo('SIGTERM exits 1 after SHUTDOWN_GRACE_MS when an inflight request never completes');
});
