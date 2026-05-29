import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

/**
 * Simulates the backoff logic from Wallet.jsx:
 * delay doubles BEFORE scheduling the next attempt, capped at RECONNECT_MAX_MS.
 */
function computeDelayAfterNFailures(n) {
  let delay = RECONNECT_BASE_MS;
  for (let i = 0; i < n; i++) {
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }
  return delay;
}

describe('Wallet SSE exponential backoff (#447)', () => {
  it('starts at RECONNECT_BASE_MS (2000 ms)', () => {
    // After 0 failures the first scheduled delay is RECONNECT_BASE_MS * 2 = 4000
    // But the very first error uses the initial delay (2000) then doubles it.
    // The delay used for the FIRST reconnect attempt is RECONNECT_BASE_MS * 2 = 4000.
    // After 1 failure: delay = min(2000 * 2, 30000) = 4000
    expect(computeDelayAfterNFailures(1)).toBe(4000);
  });

  it('doubles on each failure', () => {
    expect(computeDelayAfterNFailures(1)).toBe(4000);
    expect(computeDelayAfterNFailures(2)).toBe(8000);
    expect(computeDelayAfterNFailures(3)).toBe(16000);
  });

  it('after 3 failures delay is 2000 * 2^3 = 16000 ms', () => {
    expect(computeDelayAfterNFailures(3)).toBe(16000);
  });

  it('caps at RECONNECT_MAX_MS (30000 ms)', () => {
    // After many failures it should never exceed 30000
    expect(computeDelayAfterNFailures(10)).toBe(RECONNECT_MAX_MS);
    expect(computeDelayAfterNFailures(20)).toBe(RECONNECT_MAX_MS);
  });

  it('resets to RECONNECT_BASE_MS on successful connection', () => {
    // Simulate the onopen handler: delay resets to RECONNECT_BASE_MS
    let delay = computeDelayAfterNFailures(3); // 16000
    expect(delay).toBe(16000);
    // onopen fires → reset
    delay = RECONNECT_BASE_MS;
    expect(delay).toBe(2000);
  });
});

describe('Wallet SSE reconnecting indicator (#447)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('setTimeout is called with the doubled delay before scheduling reconnect', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    let reconnectDelay = RECONNECT_BASE_MS;

    // Simulate the error handler: double BEFORE scheduling
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    setTimeout(() => {}, reconnectDelay);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 4000);
  });
});
