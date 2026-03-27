/**
 * Cross-browser compatibility tests.
 *
 * These tests verify that critical user flows work consistently across all
 * browsers in the Playwright project matrix. They run against a live dev/preview
 * server and do NOT require a real backend — the app's own error states and
 * static rendering are sufficient to validate browser compatibility.
 *
 * Test matrix (defined in playwright.config.js):
 *   Desktop : Chromium, Firefox, WebKit (Safari), Edge
 *   Mobile  : Pixel 7 (Android Chrome), iPhone 14 (iOS Safari), iPad Pro (iPadOS)
 */

import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Navigate to a page and wait for the network to settle. */
async function goto(page, path) {
  await page.goto(path, { waitUntil: 'networkidle' });
}

// ── 1. Page load & basic rendering ───────────────────────────────────────────

test.describe('Page load', () => {
  test('login page renders and is interactive', async ({ page }) => {
    await goto(page, '/login');
    await expect(page).toHaveTitle(/Farmers Marketplace|FarmersMarket|Marketplace/i);
    // Email and password inputs must be present and focusable
    const email = page.getByRole('textbox', { name: /email/i });
    const password = page.locator('input[type="password"]');
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await email.click();
    await email.fill('test@example.com');
    await expect(email).toHaveValue('test@example.com');
  });

  test('register page renders with role selector', async ({ page }) => {
    await goto(page, '/register');
    const roleSelect = page.locator('select');
    await expect(roleSelect).toBeVisible();
  });

  test('marketplace page renders without auth', async ({ page }) => {
    await goto(page, '/marketplace');
    // Should show the marketplace heading or redirect to login
    const heading = page.getByText(/Marketplace|Login/i).first();
    await expect(heading).toBeVisible();
  });
});

// ── 2. CSS layout & responsive design ────────────────────────────────────────

test.describe('Responsive layout', () => {
  test('navbar is visible on desktop', async ({ page }) => {
    await goto(page, '/login');
    const nav = page.locator('nav, header').first();
    await expect(nav).toBeVisible();
  });

  test('login form is not clipped on mobile viewport', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test');
    await goto(page, '/login');
    const form = page.locator('form').first();
    const box = await form.boundingBox();
    expect(box).not.toBeNull();
    // Form must not overflow the viewport width
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 2);
  });

  test('marketplace grid reflows on narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goto(page, '/marketplace');
    // Page should not have horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });
});

// ── 3. Form interaction & input handling ─────────────────────────────────────

test.describe('Form interaction', () => {
  test('login form shows validation on empty submit', async ({ page }) => {
    await goto(page, '/login');
    const btn = page.getByRole('button', { name: /login|sign in/i });
    await btn.click();
    // Either native browser validation or custom error message
    const hasNativeValidity = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[required]');
      return [...inputs].some(i => !i.validity.valid);
    });
    const hasCustomError = await page.locator('[class*="err"], [class*="error"]').count() > 0;
    expect(hasNativeValidity || hasCustomError).toBe(true);
  });

  test('password input type is password (not plain text)', async ({ page }) => {
    await goto(page, '/login');
    const type = await page.locator('input[type="password"]').getAttribute('type');
    expect(type).toBe('password');
  });

  test('number input on product detail accepts numeric entry', async ({ page }) => {
    // Navigate to a product detail page — will redirect or show 404 state
    await goto(page, '/product/1');
    const numInput = page.locator('input[type="number"]');
    if (await numInput.count() > 0) {
      await numInput.fill('3');
      await expect(numInput).toHaveValue('3');
    }
  });
});

// ── 4. Navigation & routing ───────────────────────────────────────────────────

test.describe('Client-side routing', () => {
  test('navigating to unknown route does not crash', async ({ page }) => {
    await goto(page, '/this-route-does-not-exist');
    // Should not show a blank white page or JS error
    const body = await page.locator('body').textContent();
    expect(body.trim().length).toBeGreaterThan(0);
  });

  test('back navigation works after page change', async ({ page }) => {
    await goto(page, '/login');
    await goto(page, '/register');
    await page.goBack();
    await expect(page).toHaveURL(/login/);
  });
});

// ── 5. Accessibility basics ───────────────────────────────────────────────────

test.describe('Accessibility', () => {
  test('login page has no missing alt text on images', async ({ page }) => {
    await goto(page, '/login');
    const imgsWithoutAlt = await page.locator('img:not([alt])').count();
    expect(imgsWithoutAlt).toBe(0);
  });

  test('interactive elements are keyboard-focusable', async ({ page }) => {
    await goto(page, '/login');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A', 'SELECT', 'TEXTAREA']).toContain(focused);
  });
});

// ── 6. Browser-specific feature detection ────────────────────────────────────

test.describe('Browser feature support', () => {
  test('fetch API is available', async ({ page }) => {
    await goto(page, '/login');
    const hasFetch = await page.evaluate(() => typeof window.fetch === 'function');
    expect(hasFetch).toBe(true);
  });

  test('CSS custom properties (variables) are supported', async ({ page }) => {
    await goto(page, '/login');
    const supported = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.setProperty('--test-var', '1px');
      return el.style.getPropertyValue('--test-var') === '1px';
    });
    expect(supported).toBe(true);
  });

  test('localStorage is accessible', async ({ page }) => {
    await goto(page, '/login');
    const accessible = await page.evaluate(() => {
      try { localStorage.setItem('__test__', '1'); localStorage.removeItem('__test__'); return true; }
      catch { return false; }
    });
    expect(accessible).toBe(true);
  });

  test('IntersectionObserver is available', async ({ page }) => {
    await goto(page, '/login');
    const available = await page.evaluate(() => typeof window.IntersectionObserver === 'function');
    expect(available).toBe(true);
  });
});

// ── 7. Network & error resilience ────────────────────────────────────────────

test.describe('Network resilience', () => {
  test('app renders gracefully when API is unreachable', async ({ page }) => {
    // Block all API calls
    await page.route('**/api/**', route => route.abort());
    await goto(page, '/marketplace');
    // Should not show an unhandled JS error overlay
    const body = await page.locator('body').textContent();
    expect(body.trim().length).toBeGreaterThan(0);
  });

  test('app handles slow network without blank screen', async ({ page }) => {
    // Delay all API responses by 2 s
    await page.route('**/api/**', async route => {
      await new Promise(r => setTimeout(r, 2000));
      await route.continue();
    });
    await page.goto('/marketplace', { timeout: 15_000 });
    const body = await page.locator('body').textContent();
    expect(body.trim().length).toBeGreaterThan(0);
  });
});
