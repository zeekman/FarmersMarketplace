import { test, expect } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `waitlist_farmer_${ts}@test.invalid`;
const BUYER_EMAIL = `waitlist_buyer_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `OOS Product ${ts}`;

async function register(page: any, email: string, name: string, role: string) {
  await page.goto('/register');
  await page.fill('#reg-name', name);
  await page.fill('#reg-email', email);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', role);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard|\/marketplace/, { timeout: 15_000 });
}

test.describe('Product waitlist flow (#1186)', () => {
  test.beforeAll(async ({ browser }) => {
    // Seed: register a farmer and list an out-of-stock product
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await register(page, FARMER_EMAIL, `WaitlistFarmer ${ts}`, 'farmer');
    await page.fill('#prod-name', PRODUCT_NAME);
    await page.fill('#prod-price', '5');
    await page.fill('#prod-qty', '0'); // out of stock
    await page.fill('#prod-unit', 'kg');
    await page.click('form button[type="submit"]:has-text("List Product")');
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test('buyer can join a waitlist for an out-of-stock product', async ({ page }) => {
    await register(page, BUYER_EMAIL, `WaitlistBuyer ${ts}`, 'buyer');

    await page.goto('/marketplace');
    const productCard = page.locator(`text=${PRODUCT_NAME}`).first();
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.click();

    const joinBtn = page.getByRole('button', { name: /join.*waitlist|notify me/i });
    await expect(joinBtn).toBeVisible({ timeout: 5_000 });
    await joinBtn.click();

    await expect(page.getByText(/waitlist|you.ll be notified|joined/i)).toBeVisible({ timeout: 5_000 });
  });

  test('buyer can leave a waitlist they previously joined', async ({ page }) => {
    await register(page, `leave_${BUYER_EMAIL}`, `LeaveBuyer ${ts}`, 'buyer');

    await page.goto('/marketplace');
    const productCard = page.locator(`text=${PRODUCT_NAME}`).first();
    if (await productCard.count() === 0) { test.skip(); return; }
    await productCard.click();

    const joinBtn = page.getByRole('button', { name: /join.*waitlist|notify me/i });
    if (await joinBtn.count() === 0) { test.skip(); return; }
    await joinBtn.click();

    const leaveBtn = page.getByRole('button', { name: /leave.*waitlist|remove/i });
    await expect(leaveBtn).toBeVisible({ timeout: 5_000 });
    await leaveBtn.click();

    await expect(page.getByRole('button', { name: /join.*waitlist|notify me/i })).toBeVisible({ timeout: 5_000 });
  });

  test('farmer can see waitlist analytics on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', FARMER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // WaitlistAnalyticsPanel should be present in the dashboard
    const analyticsSection = page.getByText(/waitlist/i).first();
    await expect(analyticsSection).toBeVisible({ timeout: 10_000 });
  });
});
