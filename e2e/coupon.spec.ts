/**
 * E2E spec: Coupon code redemption at checkout (#1045)
 *
 * Covers:
 *   - A buyer applies a valid coupon on a product detail page and the
 *     discounted total is shown correctly.
 *   - A buyer enters an invalid (nonexistent) coupon code and asserts a
 *     clear inline error with no discount applied.
 *
 * Seeding strategy:
 *   We create a farmer + product + coupon via the UI / API so the tests are
 *   self-contained and do not depend on any pre-existing DB state.
 *
 * CSRF notes:
 *   The backend exposes the CSRF seed endpoint at /api/csrf-token (app.js).
 *   The /api/v1 prefix only covers the business-logic routes registered via
 *   registerRoute() — NOT the csrf-token endpoint — so we must call
 *   /api/csrf-token here.
 *
 *   However, the frontend client.js auto-fetches the CSRF cookie before any
 *   mutating call; for API-level seeding from the test runner we call the
 *   endpoint ourselves to obtain the cookie that the browser context will
 *   forward on subsequent requests.  We pass it as both a cookie and as the
 *   x-csrf-token header to satisfy the double-submit-cookie check.
 */

import { test, expect, APIRequestContext } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL  = `farmer_coupon_${ts}@test.invalid`;
const BUYER_EMAIL   = `buyer_coupon_${ts}@test.invalid`;
const PASS          = 'TestPass1!';
const PRODUCT_NAME  = `Coupon Apples ${ts}`;
const PRODUCT_PRICE = 10; // XLM
const COUPON_CODE   = `SAVE20_${ts}`;
const DISCOUNT_PCT  = 20;

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Seed the CSRF cookie and return the token value so we can also send it as
 * the x-csrf-token header.  The endpoint is at /api/csrf-token (app.js).
 */
async function getCsrf(req: APIRequestContext): Promise<string> {
  const res  = await req.get('/api/csrf-token');
  const body = await res.json();
  return body.csrfToken as string;
}

async function apiLogin(
  req: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res  = await req.post('/api/v1/auth/login', { data: { email, password } });
  const body = await res.json();
  return body.token as string;
}

// ─── seed ─────────────────────────────────────────────────────────────────────

let productId: number;

test.beforeAll(async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  // 1. Register farmer via UI
  await page.goto('/register');
  await page.fill('#reg-name',     `Coupon Farmer ${ts}`);
  await page.fill('#reg-email',    FARMER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'farmer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // 2. List a product via the dashboard form
  await page.fill('#prod-name',  PRODUCT_NAME);
  await page.fill('#prod-price', String(PRODUCT_PRICE));
  await page.fill('#prod-qty',   '50');
  await page.fill('#prod-unit',  'kg');
  await page.click('form button[type="submit"]:has-text("List Product")');
  await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

  // 3. Fetch the product id from the farmer's listing API
  const farmerToken = await apiLogin(page.request, FARMER_EMAIL, PASS);
  const prodRes = await page.request.get('/api/v1/products/mine/list', {
    headers: { Authorization: `Bearer ${farmerToken}` },
  });
  const { data: products } = await prodRes.json();
  const product = (products as any[]).find((p: any) => p.name === PRODUCT_NAME);
  expect(product, 'seeded product must exist in farmer listings').toBeTruthy();
  productId = product.id;

  // 4. Create the coupon via the API
  //    Must fetch CSRF first — endpoint is /api/csrf-token, not /api/v1/csrf-token
  const csrf = await getCsrf(page.request);
  const couponRes = await page.request.post('/api/v1/coupons', {
    headers: {
      Authorization: `Bearer ${farmerToken}`,
      'x-csrf-token': csrf,
    },
    data: {
      code:           COUPON_CODE,
      discount_type:  'percent',
      discount_value: DISCOUNT_PCT,
    },
  });
  expect(
    couponRes.ok(),
    `coupon creation should succeed (got ${couponRes.status()}: ${await couponRes.text()})`,
  ).toBeTruthy();

  // 5. Register the buyer via UI
  await page.goto('/register');
  await page.fill('#reg-name',     `Coupon Buyer ${ts}`);
  await page.fill('#reg-email',    BUYER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'buyer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 15_000 });

  await ctx.close();
});

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('Coupon redemption (#1045)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email',    BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });
  });

  test('valid coupon shows discounted total and success message', async ({ page }) => {
    await page.goto(`/product/${productId}`);
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    // Coupon input is only rendered for buyers when stock > 0
    const couponInput = page.locator('input[placeholder="Coupon code"]');
    await expect(couponInput).toBeVisible({ timeout: 10_000 });

    await couponInput.fill(COUPON_CODE);
    await page.click('button:has-text("Apply")');

    // Success: inline confirmation rendered by the `{couponResult && …}` block
    // The actual text is: "✅ Coupon applied — 20% off …"
    await expect(page.locator('text=✅ Coupon applied').first()).toBeVisible({ timeout: 10_000 });

    // Discounted total: PRODUCT_PRICE * (1 - DISCOUNT_PCT/100) formatted to 2 dp
    const expectedFinal = (PRODUCT_PRICE * (1 - DISCOUNT_PCT / 100)).toFixed(2);
    await expect(page.locator(`text=${expectedFinal} XLM`).first()).toBeVisible({ timeout: 5_000 });

    // Original price must appear struck-through.
    // ProductDetail.jsx applies `textDecoration: 'line-through'` as an inline
    // style — not a <s> or <del> element.
    const strikethrough = page.locator('[style*="line-through"]').first();
    await expect(strikethrough).toBeVisible();
  });

  test('invalid coupon code shows inline error with no discount', async ({ page }) => {
    await page.goto(`/product/${productId}`);
    await expect(page.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    const couponInput = page.locator('input[placeholder="Coupon code"]');
    await expect(couponInput).toBeVisible({ timeout: 10_000 });

    await couponInput.fill('NOTVALID99999');
    await page.click('button:has-text("Apply")');

    // The `couponError` state renders inside a div with s.err styling.
    // The backend returns the message "Invalid coupon code" for unknown codes.
    await expect(
      page.locator('text=Invalid coupon code').first(),
    ).toBeVisible({ timeout: 10_000 });

    // Success banner must NOT be visible
    await expect(page.locator('text=✅ Coupon applied')).toHaveCount(0);

    // No strikethrough (discount not applied)
    await expect(page.locator('[style*="line-through"]')).toHaveCount(0);
  });
});
