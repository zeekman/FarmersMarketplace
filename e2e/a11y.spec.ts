/**
 * E2E spec: automated accessibility checks for the main routes (#1397)
 *
 * Replaces the runtime @axe-core/react hook (unsupported on React 18+) with
 * @axe-core/playwright scans against the real, rendered app. The test fails
 * on any violation with `serious` or `critical` impact, so the E2E CI job
 * fails when one is introduced.
 *
 * Routes covered: marketplace, product detail, login, dashboard, wallet.
 */

import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ts = Date.now();
const FARMER_EMAIL = `farmer_a11y_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `A11y Beans ${ts}`;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

async function expectNoSeriousViolations(page: Page, route: string) {
  // Let data-driven content settle before scanning. `networkidle` is not
  // usable here because the wallet keeps an SSE stream open.
  await page.waitForLoadState('load');
  await page.waitForTimeout(1_000);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''));

  const summary = blocking
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n    ${v.helpUrl}`)
    .join('\n');

  expect(blocking, `Serious/critical a11y violations on ${route}:\n${summary}`).toEqual([]);
}

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('#login-email', FARMER_EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

let productId: number;

test.describe('Accessibility (axe)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/register');
    await page.fill('#reg-name', `A11y Farmer ${ts}`);
    await page.fill('#reg-email', FARMER_EMAIL);
    await page.fill('#reg-password', PASS);
    await page.selectOption('#reg-role', 'farmer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await page.fill('#prod-name', PRODUCT_NAME);
    await page.fill('#prod-price', '2');
    await page.fill('#prod-qty', '20');
    await page.fill('#prod-unit', 'kg');
    await page.click('form button[type="submit"]:has-text("List Product")');
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    const loginRes = await page.request.post('/api/v1/auth/login', {
      data: { email: FARMER_EMAIL, password: PASS },
    });
    const { token } = await loginRes.json();
    const prodRes = await page.request.get('/api/v1/products/mine/list', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { data: products } = await prodRes.json();
    const product = (products as any[]).find((p: any) => p.name === PRODUCT_NAME);
    expect(product, 'seeded product must exist in farmer listings').toBeTruthy();
    productId = product.id;

    await ctx.close();
  });

  test('login page', async ({ page }) => {
    await page.goto('/login');
    await expectNoSeriousViolations(page, '/login');
  });

  test('marketplace page', async ({ page }) => {
    await page.goto('/marketplace');
    await expectNoSeriousViolations(page, '/marketplace');
  });

  test('product detail page', async ({ page }) => {
    await page.goto(`/product/${productId}`);
    await expect(page.locator(`text=${PRODUCT_NAME}`).first()).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousViolations(page, '/product/:id');
  });

  test('dashboard page', async ({ page }) => {
    await login(page);
    await expectNoSeriousViolations(page, '/dashboard');
  });

  test('wallet page', async ({ page }) => {
    await login(page);
    await page.goto('/wallet');
    await expectNoSeriousViolations(page, '/wallet');
  });
});
