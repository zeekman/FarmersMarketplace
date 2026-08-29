import { test, expect, APIRequestContext } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `farmer_bundle_${ts}@test.invalid`;
const BUYER_EMAIL = `buyer_bundle_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const ITEM_NAME = `E2E Bundle Peppers ${ts}`;
const BUNDLE_NAME = `E2E Deal Bundle ${ts}`;
const ITEM_PRICE = 2;
const ITEM_QTY_IN_BUNDLE = 3;
const BUNDLE_PRICE = 4.5; // discounted vs. ITEM_PRICE * ITEM_QTY_IN_BUNDLE = 6

async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('/api/v1/auth/login', { data: { email, password } });
  const body = await res.json();
  return body.token as string;
}

async function fetchCsrfToken(request: APIRequestContext) {
  const res = await request.get('/api/auth/csrf-token');
  const body = await res.json();
  return body.csrfToken as string;
}

// Bundle creation has no farmer-facing UI yet, so the bundle itself is seeded via the API.
// The test's actual coverage is the buyer-facing purchase and discount-total flow.
test.describe('Bundle checkout and discount calculation', () => {
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

    await page.fill('#prod-name', ITEM_NAME);
    await page.fill('#prod-price', String(ITEM_PRICE));
    await page.fill('#prod-qty', '100');
    await page.fill('#prod-unit', 'kg');
    await page.click('form button[type="submit"]:has-text("List Product")');
    await expect(page.locator(`text=${ITEM_NAME}`)).toBeVisible({ timeout: 10_000 });

    const token = await apiLogin(page.request, FARMER_EMAIL, PASS);
    const csrfToken = await fetchCsrfToken(page.request);
    const productsRes = await page.request.get(`/api/v1/products?q=${encodeURIComponent(ITEM_NAME)}`);
    const { data: products } = await productsRes.json();
    const productId = products[0].id;
    expect(productId).toBeTruthy();

    const bundleRes = await page.request.post('/api/v1/bundles', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrfToken },
      data: {
        name: BUNDLE_NAME,
        description: 'E2E seeded bundle',
        price: BUNDLE_PRICE,
        items: [{ product_id: productId, quantity: ITEM_QTY_IN_BUNDLE }],
      },
    });
    expect(bundleRes.ok()).toBeTruthy();

    await ctx.close();
  });

  test('buyer purchases a bundle and sees the discounted total before paying', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#reg-name', `Buyer ${ts}`);
    await page.fill('#reg-email', BUYER_EMAIL);
    await page.fill('#reg-password', PASS);
    await page.selectOption('#reg-role', 'buyer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/);

    await page.goto('/wallet');
    await page.click('button:has-text("Fund")');
    await page.waitForTimeout(5_000);

    await page.goto('/marketplace');
    const bundleCard = page
      .locator('div')
      .filter({ hasText: BUNDLE_NAME })
      .filter({ has: page.locator('button:has-text("Buy Bundle")') })
      .last();
    await expect(bundleCard).toBeVisible({ timeout: 10_000 });

    // Checkout total reflects the discounted bundle price, not the sum of individual item prices
    const individualTotal = ITEM_PRICE * ITEM_QTY_IN_BUNDLE;
    expect(BUNDLE_PRICE).toBeLessThan(individualTotal);
    await expect(bundleCard.locator(`text=${BUNDLE_PRICE} XLM`)).toBeVisible();

    await bundleCard.locator('button:has-text("Included Items")').click();
    await expect(bundleCard.locator(`text=${ITEM_QTY_IN_BUNDLE} × ${ITEM_NAME}`)).toBeVisible();

    await bundleCard.locator('button:has-text("Buy Bundle")').click();
    await expect(bundleCard.locator('text=Paid!')).toBeVisible({ timeout: 20_000 });
  });
});
