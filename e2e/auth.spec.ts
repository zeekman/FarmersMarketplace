import { test, expect } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `farmer_auth_${ts}@test.invalid`;
const FARMER_PASS = 'TestPass1!';

test.describe('Auth', () => {
  test('register as buyer redirects to marketplace', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#reg-name', `Buyer ${ts}`);
    await page.fill('#reg-email', `buyer_auth_${ts}@test.invalid`);
    await page.fill('#reg-password', FARMER_PASS);
    await page.selectOption('#reg-role', 'buyer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/);
  });

  test('register as farmer redirects to dashboard', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#reg-name', `Farmer ${ts}`);
    await page.fill('#reg-email', FARMER_EMAIL);
    await page.fill('#reg-password', FARMER_PASS);
    await page.selectOption('#reg-role', 'farmer');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', FARMER_EMAIL);
    await page.fill('#login-password', FARMER_PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('logout redirects to login', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('#login-email', FARMER_EMAIL);
    await page.fill('#login-password', FARMER_PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.click('button:has-text("Logout")');
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected route /dashboard redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected route /wallet redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/login/);
  });

  test('invalid login shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', 'nobody@test.invalid');
    await page.fill('#login-password', 'WrongPass1!');
    await page.click('button[type="submit"]');
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
