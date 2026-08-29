import { test, expect, APIRequestContext } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `farmer_admin_${ts}@test.invalid`;
const BUYER_EMAIL = `buyer_admin_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `E2E Dispute Melons ${ts}`;
const DISPUTE_REASON = `Produce arrived damaged ${ts}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'e2e-admin@test.invalid';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestPass1!';

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

// Seeds a paid order and an open dispute directly against the API — there is no
// buyer-facing "file a dispute" UI yet, only the admin-facing resolution screen.
test.describe('Admin dispute resolution', () => {
  test.beforeAll(async ({ browser }) => {
    const farmerCtx = await browser.newContext();
    const farmerPage = await farmerCtx.newPage();

    await farmerPage.goto('/register');
    await farmerPage.fill('#reg-name', `Farmer ${ts}`);
    await farmerPage.fill('#reg-email', FARMER_EMAIL);
    await farmerPage.fill('#reg-password', PASS);
    await farmerPage.selectOption('#reg-role', 'farmer');
    await farmerPage.click('button[type="submit"]');
    await expect(farmerPage).toHaveURL(/\/dashboard/);

    await farmerPage.fill('#prod-name', PRODUCT_NAME);
    await farmerPage.fill('#prod-price', '2');
    await farmerPage.fill('#prod-qty', '50');
    await farmerPage.fill('#prod-unit', 'kg');
    await farmerPage.click('form button[type="submit"]:has-text("List Product")');
    await expect(farmerPage.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });
    await farmerCtx.close();

    const buyerCtx = await browser.newContext();
    const buyerPage = await buyerCtx.newPage();

    await buyerPage.goto('/register');
    await buyerPage.fill('#reg-name', `Buyer ${ts}`);
    await buyerPage.fill('#reg-email', BUYER_EMAIL);
    await buyerPage.fill('#reg-password', PASS);
    await buyerPage.selectOption('#reg-role', 'buyer');
    await buyerPage.click('button[type="submit"]');
    await expect(buyerPage).toHaveURL(/\/marketplace/);

    await buyerPage.goto('/wallet');
    await buyerPage.click('button:has-text("Fund")');
    await buyerPage.waitForTimeout(5_000);

    await buyerPage.goto('/marketplace');
    await buyerPage.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await buyerPage.waitForTimeout(1_000);
    await buyerPage.locator(`[aria-label="View ${PRODUCT_NAME}"]`).first().click();
    await buyerPage.waitForURL(/\/product\//);
    await buyerPage.click('button:has-text("Buy Now")');
    await buyerPage.waitForTimeout(15_000); // Stellar tx confirmation

    const token = await apiLogin(buyerPage.request, BUYER_EMAIL, PASS);
    const csrfToken = await fetchCsrfToken(buyerPage.request);
    const ordersRes = await buyerPage.request.get('/api/v1/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { data: orders } = await ordersRes.json();
    const order = orders.find((o: any) => o.product_name === PRODUCT_NAME);
    expect(order, 'seeded order for the disputed product should exist').toBeTruthy();

    const disputeRes = await buyerPage.request.post('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrfToken },
      data: { order_id: order.id, reason: DISPUTE_REASON },
    });
    expect(disputeRes.ok()).toBeTruthy();

    await buyerCtx.close();
  });

  test('admin logs in, views the open dispute, and resolves it', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', ADMIN_EMAIL);
    await page.fill('#login-password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/admin/);

    const disputeRow = page.locator('tr').filter({ hasText: DISPUTE_REASON });
    await expect(disputeRow).toBeVisible({ timeout: 10_000 });
    await expect(disputeRow.locator('text=open')).toBeVisible();
    await expect(disputeRow.locator(`text=${PRODUCT_NAME}`)).toBeVisible();

    await disputeRow.locator('button:has-text("Resolve")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('select').selectOption('farmer');
    await dialog.locator('button:has-text("Confirm")').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const resolvedRow = page.locator('tr').filter({ hasText: DISPUTE_REASON });
    await expect(resolvedRow.locator('text=resolved')).toBeVisible({ timeout: 10_000 });
    await expect(resolvedRow.locator('text=farmer')).toBeVisible();
    await expect(resolvedRow.locator('button:has-text("Resolve")')).toHaveCount(0);
  });
});
