/**
 * Service-worker update-prompt e2e tests
 *
 * Exercises the full update-available flow end-to-end:
 *
 *   new SW activates
 *     → posts { type: 'SW_UPDATED' } to all window clients
 *     → UpdatePrompt.jsx receives the message and renders the banner
 *     → user clicks "Refresh" → page reloads
 *     → user can alternatively dismiss without reloading
 *
 * Because Playwright runs against the Vite dev server (no real SW registration
 * in dev), we simulate the service-worker message via page.evaluate().
 * This is an intentional white-box technique: it tests that UpdatePrompt
 * correctly wires the message listener and renders + behaves as specified,
 * without requiring a full two-SW-version deploy cycle in CI.
 *
 * If the component is ever broken (listener removed, wrong message type,
 * wrong button labels) these tests will fail — which is the explicit goal
 * stated in the companion issue.
 */

import { test, expect } from '@playwright/test';

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Dispatch a synthetic SW_UPDATED message to the page, replicating what
 * sw.js does after activation:
 *
 *   client.postMessage({ type: 'SW_UPDATED' })
 *
 * UpdatePrompt listens on navigator.serviceWorker for this exact message.
 */
async function triggerSwUpdated(page) {
  await page.evaluate(() => {
    // Build a MessageEvent that mirrors a real SW postMessage
    const event = new MessageEvent('message', {
      data: { type: 'SW_UPDATED' },
      source: null,
      origin: location.origin,
    });

    // navigator.serviceWorker may be undefined in some test environments;
    // UpdatePrompt guards against this with optional-chaining, so we dispatch
    // directly to the serviceWorker EventTarget when available, otherwise we
    // fall back to window so the test can still exercise the banner rendering.
    const target = navigator.serviceWorker ?? window;
    target.dispatchEvent(event);
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Service-worker update prompt', () => {
  test.beforeEach(async ({ page }) => {
    // The banner is always rendered by UpdatePrompt regardless of auth state,
    // so we only need a page that mounts the component.  The root route '/'
    // renders App which includes UpdatePrompt unconditionally.
    await page.goto('/', { waitUntil: 'networkidle' });
  });

  // ── Banner appearance ───────────────────────────────────────────────────────

  test('update banner is NOT visible before SW_UPDATED is received', async ({ page }) => {
    // UpdatePrompt renders null until setShow(true) is called
    await expect(page.getByRole('alert')).not.toBeVisible();
  });

  test('update banner appears after receiving SW_UPDATED message', async ({ page }) => {
    await triggerSwUpdated(page);

    const banner = page.getByRole('alert');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/new version is available/i);
  });

  test('banner contains a "Refresh" button', async ({ page }) => {
    await triggerSwUpdated(page);

    await expect(
      page.getByRole('button', { name: /refresh to apply the update/i })
    ).toBeVisible();
  });

  test('banner contains a "Dismiss" button', async ({ page }) => {
    await triggerSwUpdated(page);

    await expect(
      page.getByRole('button', { name: /dismiss update notification/i })
    ).toBeVisible();
  });

  test('banner has aria-live="polite" for screen-reader announcement', async ({ page }) => {
    await triggerSwUpdated(page);

    const banner = page.getByRole('alert');
    await expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  // ── Dismiss path ────────────────────────────────────────────────────────────

  test('clicking Dismiss hides the banner without reloading', async ({ page }) => {
    await triggerSwUpdated(page);
    await expect(page.getByRole('alert')).toBeVisible();

    // Track whether a navigation (reload) happens
    let navigated = false;
    page.on('framenavigated', () => { navigated = true; });

    await page.getByRole('button', { name: /dismiss update notification/i }).click();

    await expect(page.getByRole('alert')).not.toBeVisible();
    expect(navigated).toBe(false);
  });

  test('banner can be triggered again after a dismiss', async ({ page }) => {
    await triggerSwUpdated(page);
    await page.getByRole('button', { name: /dismiss update notification/i }).click();
    await expect(page.getByRole('alert')).not.toBeVisible();

    // A second SW_UPDATED (e.g. another deploy) should show the banner again
    await triggerSwUpdated(page);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  // ── Refresh path ────────────────────────────────────────────────────────────

  test('clicking Refresh triggers a page reload', async ({ page }) => {
    await triggerSwUpdated(page);

    // Intercept the reload by watching for a navigation event
    const reloadPromise = page.waitForNavigation({ waitUntil: 'commit', timeout: 5000 });
    await page.getByRole('button', { name: /refresh to apply the update/i }).click();

    // If UpdatePrompt calls window.location.reload() this navigation resolves
    await expect(reloadPromise).resolves.toBeTruthy();
  });

  test('after reload the banner is no longer showing (fresh mount, show=false)', async ({
    page,
  }) => {
    await triggerSwUpdated(page);
    await page.getByRole('button', { name: /refresh to apply the update/i }).click();

    // Wait for the reload to complete
    await page.waitForLoadState('networkidle');

    // UpdatePrompt initialises with show=false — banner must be absent on fresh mount
    await expect(page.getByRole('alert')).not.toBeVisible();
  });

  // ── Message contract ────────────────────────────────────────────────────────

  test('ignores messages with a different type (no banner shown)', async ({ page }) => {
    await page.evaluate(() => {
      const event = new MessageEvent('message', {
        data: { type: 'SOME_OTHER_EVENT' },
        origin: location.origin,
      });
      const target = navigator.serviceWorker ?? window;
      target.dispatchEvent(event);
    });

    // Give React a tick to process any state update
    await page.waitForTimeout(200);
    await expect(page.getByRole('alert')).not.toBeVisible();
  });

  test('ignores messages with no data', async ({ page }) => {
    await page.evaluate(() => {
      const event = new MessageEvent('message', { data: null, origin: location.origin });
      const target = navigator.serviceWorker ?? window;
      target.dispatchEvent(event);
    });

    await page.waitForTimeout(200);
    await expect(page.getByRole('alert')).not.toBeVisible();
  });
});
