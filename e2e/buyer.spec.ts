import { test, expect } from '@playwright/test';

const ts = Date.now();
const BUYER_EMAIL = `buyer_${ts}@test.invalid`;
const FARMER_EMAIL = `farmer_for_buyer_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `E2E Carrots ${ts}`;

test.describe('Buyer journey', () => {
  test.beforeAll(async ({ browser }) => {
    // Seed: register a farmer and list a product
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/register');
    await page.fill('#reg-name', `Seed Farmer ${ts}`);
    await page.fill('#reg-email', FARMER_EMAIL);
    await page.fill('#reg-password', PASS);
    await page.selectOption('#reg-role', 'farmer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('#prod-name', PRODUCT_NAME);
    await page.fill('#prod-price', '1');
    await page.fill('#prod-qty', '100');
    await page.fill('#prod-unit', 'kg');
    await page.click('form button[type="submit"]:has-text("List Product")');
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });

  test('register as buyer and land on marketplace', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#reg-name', `Buyer ${ts}`);
    await page.fill('#reg-email', BUYER_EMAIL);
    await page.fill('#reg-password', PASS);
    await page.selectOption('#reg-role', 'buyer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/);
  });

  test('fund wallet via Friendbot', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('#login-email', BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/);

    await page.goto('/wallet');
    await page.click('button:has-text("Fund")');
    // Balance should update (non-zero) within a few seconds
    await expect(page.locator('text=XLM').first()).toBeVisible({ timeout: 15_000 });
  });

  test('browse marketplace and see listed product', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');

    await page.goto('/marketplace');
    await page.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await page.waitForTimeout(800);
    await expect(page.locator(`[aria-label="View ${PRODUCT_NAME}"]`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('complete a purchase', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');

    // Fund wallet first
    await page.goto('/wallet');
    await page.click('button:has-text("Fund")');
    await page.waitForTimeout(5_000);

    // Find product
    await page.goto('/marketplace');
    await page.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await page.waitForTimeout(800);
    const card = page.locator(`[aria-label="View ${PRODUCT_NAME}"]`).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    await page.waitForURL(/\/product\//);
    await page.click('button:has-text("Buy Now")');

    // Wait for Stellar tx — success message or tx hash
    await expect(
      page.locator('text=success').or(page.locator('text=TX')).or(page.locator('text=paid')).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
