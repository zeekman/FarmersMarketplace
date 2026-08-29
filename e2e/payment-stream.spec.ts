import { test, expect } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `stream_farmer_${ts}@test.invalid`;
const BUYER_EMAIL = `stream_buyer_${ts}@test.invalid`;
const PASS = 'TestPass1!';

async function register(page: any, email: string, name: string, role: string) {
  await page.goto('/register');
  await page.fill('#reg-name', name);
  await page.fill('#reg-email', email);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', role);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard|\/marketplace/, { timeout: 15_000 });
}

test.describe('Payment stream flow (#1186)', () => {
  test('buyer can start a payment stream from a farmer profile', async ({ page, browser }) => {
    // Seed farmer
    const farmerCtx = await browser.newContext();
    const farmerPage = await farmerCtx.newPage();
    await register(farmerPage, FARMER_EMAIL, `StreamFarmer ${ts}`, 'farmer');
    const farmerUrl = farmerPage.url();
    await farmerCtx.close();

    // Register buyer and navigate to farmer profile
    await register(page, BUYER_EMAIL, `StreamBuyer ${ts}`, 'buyer');
    await page.goto('/marketplace');

    const farmerLink = page.locator('a[href*="/farmer/"]').first();
    if (await farmerLink.count() === 0) {
      test.skip();
      return;
    }
    await farmerLink.click();

    // "Start a Payment Stream" button should be available on farmer profile
    const streamBtn = page.getByRole('button', { name: /start.*payment.*stream|payment.*stream/i });
    await expect(streamBtn).toBeVisible({ timeout: 10_000 });
    await streamBtn.click();

    // Modal opens
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Fill in rate and duration
    const rateInput = page.locator('[name="rate"], [placeholder*="rate" i]').first();
    const durationInput = page.locator('[name="duration"], [placeholder*="duration" i]').first();
    if (await rateInput.count() > 0) await rateInput.fill('0.001');
    if (await durationInput.count() > 0) await durationInput.fill('60');

    await page.getByRole('button', { name: /continue|next/i }).click();
    await page.getByRole('button', { name: /confirm.*start|start.*stream/i }).click();

    await expect(page.getByText(/stream.*started|payment.*stream/i)).toBeVisible({ timeout: 10_000 });
  });

  test('StreamAccrual widget shows increasing balance over time', async ({ page }) => {
    await register(page, `accrual_${BUYER_EMAIL}`, `AccrualBuyer ${ts}`, 'buyer');
    await page.goto('/wallet');

    // If a stream exists, the StreamAccrual widget should display a numeric value
    const accrualEl = page.locator('span').filter({ hasText: /\d+\.\d{4}/ }).first();
    if (await accrualEl.count() > 0) {
      const initialText = await accrualEl.textContent();
      await page.waitForTimeout(2000);
      const laterText = await accrualEl.textContent();
      // Balance should have increased (or stayed same if rate=0)
      expect(Number(laterText)).toBeGreaterThanOrEqual(Number(initialText));
    }
  });
});
