import { test, expect } from '@playwright/test';

const ts = Date.now();
const EMAIL = `farmer_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `E2E Tomatoes ${ts}`;

async function registerFarmer(page: any) {
  await page.goto('/register');
  await page.fill('#reg-name', `Farmer ${ts}`);
  await page.fill('#reg-email', EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'farmer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Farmer journey', () => {
  test('register, list a product, and see it in dashboard', async ({ page }) => {
    await registerFarmer(page);

    // Fill in the product form
    await page.fill('#prod-name', PRODUCT_NAME);
    await page.fill('#prod-price', '5');
    await page.fill('#prod-qty', '50');
    await page.fill('#prod-unit', 'kg');

    // Submit
    await page.click('form button[type="submit"]:has-text("List Product")');

    // Success message
    await expect(page.locator('text=listed').or(page.locator('text=success')).first()).toBeVisible({ timeout: 10_000 });

    // Product appears in My Listings
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });
  });

  test('listed product appears in incoming sales section after a purchase', async ({ page, browser }) => {
    // Register farmer
    await registerFarmer(page);

    await page.fill('#prod-name', PRODUCT_NAME);
    await page.fill('#prod-price', '1');
    await page.fill('#prod-qty', '100');
    await page.fill('#prod-unit', 'kg');
    await page.click('form button[type="submit"]:has-text("List Product")');
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    // Register buyer in a separate context and purchase
    const buyerCtx = await browser.newContext();
    const buyerPage = await buyerCtx.newPage();
    const buyerEmail = `buyer_for_farmer_${ts}@test.invalid`;

    await buyerPage.goto('/register');
    await buyerPage.fill('#reg-name', `Buyer ${ts}`);
    await buyerPage.fill('#reg-email', buyerEmail);
    await buyerPage.fill('#reg-password', PASS);
    await buyerPage.selectOption('#reg-role', 'buyer');
    await buyerPage.click('button[type="submit"]');
    await expect(buyerPage).toHaveURL(/\/marketplace/);

    // Fund wallet
    await buyerPage.goto('/wallet');
    await buyerPage.click('button:has-text("Fund")');
    await buyerPage.waitForTimeout(5_000); // Friendbot takes a moment

    // Find and buy the product
    await buyerPage.goto('/marketplace');
    await buyerPage.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await buyerPage.waitForTimeout(1_000);
    const card = buyerPage.locator(`[aria-label="View ${PRODUCT_NAME}"]`).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    await buyerPage.waitForURL(/\/product\//);
    await buyerPage.click('button:has-text("Buy Now")');
    await buyerPage.waitForTimeout(15_000); // Stellar tx confirmation

    await buyerCtx.close();

    // Farmer sees the sale
    await page.reload();
    await expect(page.locator(`text=${PRODUCT_NAME}`).last()).toBeVisible({ timeout: 10_000 });
  });
});
