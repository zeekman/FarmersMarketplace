/**
 * Theme e2e tests
 *
 * Covers:
 *   1. Light ↔ dark manual toggle (via the navbar "Toggle dark mode" button)
 *   2. Revert to system theme via the "Use system theme" button (#450 companion)
 *
 * The "Use system theme" and "Toggle dark mode" buttons are only rendered when
 * a user is logged in (they live inside the authenticated branch of Navbar.jsx).
 * We inject a minimal user object into localStorage to skip the real auth flow —
 * the AuthContext bootstraps from localStorage['user'] on mount, so this is a
 * supported pathway.
 *
 * Theme state is verified through:
 *   - document.documentElement[data-theme] (set by ThemeContext on every change)
 *   - localStorage['theme'] (persisted by ThemeContext; absent when using system)
 */

import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Inject a fake authenticated user so the navbar shows auth controls. */
async function injectUser(page, role = 'buyer') {
  await page.addInitScript((r) => {
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 1, name: 'Test User', email: 'test@example.com', role: r })
    );
  }, role);
}

/** Read the current data-theme attribute from the root element. */
function getDataTheme(page) {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

/** Read localStorage['theme'] (null when using system preference). */
function getStoredTheme(page) {
  return page.evaluate(() => localStorage.getItem('theme'));
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Theme controls', () => {
  test.beforeEach(async ({ page }) => {
    // Always start with light mode explicitly set so tests are deterministic
    // regardless of the runner's OS colour scheme.
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'light');
    });
  });

  // ── Manual toggle ───────────────────────────────────────────────────────────

  test.describe('manual light/dark toggle', () => {
    test('toggle button switches from light to dark', async ({ page }) => {
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      await expect(page.getByRole('button', { name: /toggle dark mode/i })).toBeVisible();
      await page.getByRole('button', { name: /toggle dark mode/i }).click();

      await expect.poll(() => getDataTheme(page)).toBe('dark');
      expect(await getStoredTheme(page)).toBe('dark');
    });

    test('toggle button switches back from dark to light', async ({ page }) => {
      // Pre-seed dark
      await page.addInitScript(() => { localStorage.setItem('theme', 'dark'); });
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      await page.getByRole('button', { name: /toggle dark mode/i }).click();

      await expect.poll(() => getDataTheme(page)).toBe('light');
      expect(await getStoredTheme(page)).toBe('light');
    });

    test('theme persists across a page reload', async ({ page }) => {
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /toggle dark mode/i }).click();
      await expect.poll(() => getDataTheme(page)).toBe('dark');

      await page.reload({ waitUntil: 'networkidle' });

      expect(await getDataTheme(page)).toBe('dark');
      expect(await getStoredTheme(page)).toBe('dark');
    });
  });

  // ── System theme revert ─────────────────────────────────────────────────────
  //
  // Acceptance criterion: e2e/theme.spec.ts is extended to cover reverting to
  // "system" theme via a reachable UI control.
  //
  // The control is the "Use system" / "System" button rendered in Navbar.jsx
  // when a user is authenticated (aria-label="Use system theme").

  test.describe('revert to system theme', () => {
    test('"Use system theme" button is visible when logged in', async ({ page }) => {
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      await expect(
        page.getByRole('button', { name: /use system theme/i })
      ).toBeVisible();
    });

    test('clicking "Use system theme" removes the stored theme preference', async ({ page }) => {
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      // Confirm a manual theme is in place
      expect(await getStoredTheme(page)).toBe('light');

      await page.getByRole('button', { name: /use system theme/i }).click();

      // ThemeContext removes the key when preference is 'system'
      await expect.poll(() => getStoredTheme(page)).toBeNull();
    });

    test('after clicking "Use system theme" the button label changes to "System"', async ({
      page,
    }) => {
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      await page.getByRole('button', { name: /use system theme/i }).click();

      // Navbar shows "System" when isUsingSystemTheme is true
      await expect(page.getByRole('button', { name: /use system theme/i })).toContainText(
        'System'
      );
    });

    test('system theme tracks the OS colour scheme after revert', async ({ page }) => {
      // Emulate a dark OS preference
      await page.emulateMedia({ colorScheme: 'dark' });
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      await page.getByRole('button', { name: /use system theme/i }).click();

      // With OS set to dark and no manual override, data-theme should be dark
      await expect.poll(() => getDataTheme(page)).toBe('dark');
    });

    test('system theme tracks light OS colour scheme after revert', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await injectUser(page);
      await page.goto('/', { waitUntil: 'networkidle' });

      await page.getByRole('button', { name: /use system theme/i }).click();

      await expect.poll(() => getDataTheme(page)).toBe('light');
    });

    test('"Use system theme" button is NOT visible when logged out', async ({ page }) => {
      // Do not inject user — page renders unauthenticated navbar
      await page.goto('/login', { waitUntil: 'networkidle' });

      await expect(
        page.getByRole('button', { name: /use system theme/i })
      ).not.toBeVisible();
    });
  });
});
