/**
 * E2E spec: Dark-mode toggle and persistence across page reloads (#1047)
 *
 * Covers:
 *   1. Toggling dark mode writes `data-theme="dark"` on <html> and persists
 *      the choice in localStorage so a full page reload keeps it.
 *   2. Clicking "Use system theme" removes the localStorage key; the app then
 *      respects the OS-level prefers-color-scheme — Playwright emulates it
 *      via `colorScheme: 'dark'` in the browser context.
 *
 * ThemeContext behaviour (verified against source):
 *   - localStorage key: 'theme'  (values: 'light' | 'dark'; absent = 'system')
 *   - HTML attribute:  document.documentElement → data-theme ('light' | 'dark')
 *   - When setThemePreference('system') is called, localStorage.removeItem('theme')
 *     is executed and the system theme drives data-theme.
 *
 * Navbar button aria-labels (verified against Navbar.jsx):
 *   - 'Toggle dark mode'  — flips light ↔ dark
 *   - 'Use system theme'  — clears manual preference
 *
 * Authentication:
 *   Theme toggle and "Use system" buttons are only rendered while the user is
 *   logged in (they live inside the nav-drawer's authenticated branch).
 */

import { test, expect, BrowserContext } from '@playwright/test';

const ts         = Date.now();
const USER_EMAIL = `theme_user_${ts}@test.invalid`;
const PASS       = 'TestPass1!';

// ─── one-time registration ────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/register');
  await page.fill('#reg-name',     `Theme User ${ts}`);
  await page.fill('#reg-email',    USER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'buyer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 15_000 });

  await ctx.close();
});

// ─── helper ──────────────────────────────────────────────────────────────────

async function loginAs(page: any) {
  await page.goto('/login');
  await page.fill('#login-email',    USER_EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('Theme toggle and persistence (#1047)', () => {
  test('toggling dark mode persists across a full page reload', async ({ page }) => {
    await loginAs(page);

    // Make the test deterministic: force the starting state to 'light' by
    // clearing any stored preference and reloading so the system default
    // takes effect, then ensure we start from light mode.
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload();

    // If the (possibly system-default) theme is already dark, toggle once to
    // get to light so we always test light → dark below.
    const startTheme = await page.evaluate(
      () => document.documentElement.getAttribute('data-theme'),
    );
    if (startTheme === 'dark') {
      await page.click('[aria-label="Toggle dark mode"]');
      await expect(page.locator('html[data-theme="light"]')).toBeVisible({ timeout: 3_000 });
    }

    // ── Toggle to dark mode ──────────────────────────────────────────────────
    await page.click('[aria-label="Toggle dark mode"]');
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 3_000 });

    // localStorage must record the manual preference
    const storedBeforeReload = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedBeforeReload).toBe('dark');

    // ── Full page reload ─────────────────────────────────────────────────────
    await page.reload();

    // Theme should survive because ThemeContext reads localStorage on init
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 5_000 });

    const storedAfterReload = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedAfterReload).toBe('dark');

    // ── Reset to light for clean state ──────────────────────────────────────
    await page.click('[aria-label="Toggle dark mode"]');
    await expect(page.locator('html[data-theme="light"]')).toBeVisible({ timeout: 3_000 });
  });

  test('clearing manual preference falls back to OS prefers-color-scheme (dark)', async ({
    browser,
  }) => {
    // Create a browser context that emulates dark-mode OS preference.
    // Playwright maps colorScheme:'dark' to window.matchMedia('(prefers-color-scheme: dark)').matches === true
    const darkCtx: BrowserContext = await browser.newContext({ colorScheme: 'dark' });
    const page = await darkCtx.newPage();

    await loginAs(page);

    // 1. Force a manual 'light' preference so we know localStorage is set
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();
    await expect(page.locator('html[data-theme="light"]')).toBeVisible({ timeout: 5_000 });

    // 2. Click "Use system theme" — this calls useSystemTheme() which calls
    //    setThemePreference('system') → localStorage.removeItem('theme')
    await page.click('[aria-label="Use system theme"]');

    // 3. With colorScheme:'dark', the system theme is dark → data-theme='dark'
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 5_000 });

    // 4. The manual key must have been removed
    const stored = await page.evaluate(() => localStorage.getItem('theme'));
    expect(stored).toBeNull();

    // 5. Reload to confirm the system-theme fallback also survives a reload
    //    (localStorage absent → ThemeContext reads 'system' → uses OS pref)
    await page.reload();
    await expect(page.locator('html[data-theme="dark"]')).toBeVisible({ timeout: 5_000 });

    const storedAfterReload = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedAfterReload).toBeNull();

    await darkCtx.close();
  });
});
