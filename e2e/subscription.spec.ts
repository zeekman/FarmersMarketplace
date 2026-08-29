import { test, expect } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `farmer_sub_${ts}@test.invalid`;
const BUYER_EMAIL = `buyer_sub_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `E2E Subscription Kale ${ts}`;

test.describe('Subscription pause/resume/cancel lifecycle', () => {
  let productId: number;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/register');
    await page.fill('#reg-name', `Farmer ${ts}`);
    await page.fill('#reg-email', FARMER_EMAIL);
    await page.fill('#reg-password', PASS);
    await page.selectOption('#reg-role', 'farmer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.fill('#prod-name', PRODUCT_NAME);
    await page.fill('#prod-price', '3');
    await page.fill('#prod-qty', '200');
    await page.fill('#prod-unit', 'kg');
    await page.click('form button[type="submit"]:has-text("List Product")');
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(`/api/v1/products?q=${encodeURIComponent(PRODUCT_NAME)}`);
    const { data } = await res.json();
    productId = data[0].id;
    expect(productId).toBeTruthy();

    await ctx.close();
  });

  test('create, pause, resume, and cancel a subscription', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#reg-name', `Buyer ${ts}`);
    await page.fill('#reg-email', BUYER_EMAIL);
    await page.fill('#reg-password', PASS);
    await page.selectOption('#reg-role', 'buyer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/);

    await page.goto('/subscriptions');

    // Create the subscription (Product ID, then Quantity — the only two number inputs on the page)
    await page.locator('input[type="number"]').nth(0).fill(String(productId));
    await page.locator('input[type="number"]').nth(1).fill('2');
    await page.selectOption('select', 'weekly');
    await page.click('button:has-text("Subscribe")');
    await expect(page.locator('text=Subscription created!')).toBeVisible({ timeout: 10_000 });

    const subRow = page.locator('div').filter({ hasText: PRODUCT_NAME }).filter({ hasText: 'Next billing' }).last();
    await expect(subRow).toBeVisible({ timeout: 10_000 });
    await expect(subRow.locator('text=active')).toBeVisible();
    await expect(subRow.locator('text=Next billing')).toBeVisible();

    // Pause
    await subRow.locator('button:has-text("Pause")').click();
    await expect(subRow.locator('text=paused')).toBeVisible({ timeout: 10_000 });
    await expect(subRow.locator('text=Next billing')).toBeVisible();

    // Resume
    await subRow.locator('button:has-text("Resume")').click();
    await expect(subRow.locator('text=active')).toBeVisible({ timeout: 10_000 });
    await expect(subRow.locator('text=Next billing')).toBeVisible();

    // Cancel
    await subRow.locator('button:has-text("Cancel")').click();
    const cancelDialog = page.locator('[role="dialog"]');
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.locator('button:has-text("Cancel Subscription")').click();
    await expect(page.locator('text=Subscription cancelled.')).toBeVisible({ timeout: 10_000 });
    await expect(subRow.locator('text=cancelled')).toBeVisible({ timeout: 10_000 });
    await expect(subRow.locator('text=Next billing')).toBeVisible();
  });
});
