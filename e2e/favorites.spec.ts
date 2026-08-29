/**
 * E2E spec: Favorites / wishlist persistence across login sessions (#1046)
 *
 * Covers:
 *   - A buyer favorites a product while logged in.
 *   - The buyer logs out.
 *   - The buyer logs back in and the same product is still shown as
 *     favourited — proving the state is restored from the backend
 *     (FavoritesContext.useEffect calls api.getFavorites on login) rather
 *     than relying on local-only state.
 *
 * Seeding strategy:
 *   A farmer registers and lists a product through the UI so there is a real
 *   product to favourite.  The buyer also registers through the UI.  No
 *   direct DB manipulation is needed.
 *
 * Favorite button selectors:
 *   Marketplace.jsx renders the heart as:
 *     <button title={isFavorited(p.id) ? "Remove from favorites" : "Add to favorites"}>
 *   and also with aria-label in the responsive rendering path.
 *   We use title="" which is present in both render paths.
 */

import { test, expect } from '@playwright/test';

const ts            = Date.now();
const FARMER_EMAIL  = `farmer_fav_${ts}@test.invalid`;
const BUYER_EMAIL   = `buyer_fav_${ts}@test.invalid`;
const PASS          = 'TestPass1!';
const PRODUCT_NAME  = `Fav Mangoes ${ts}`;

// ─── seed ─────────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  // ── Farmer: register and list a product ────────────────────────────────────
  const farmerCtx  = await browser.newContext();
  const farmerPage = await farmerCtx.newPage();

  await farmerPage.goto('/register');
  await farmerPage.fill('#reg-name',     `Fav Farmer ${ts}`);
  await farmerPage.fill('#reg-email',    FARMER_EMAIL);
  await farmerPage.fill('#reg-password', PASS);
  await farmerPage.selectOption('#reg-role', 'farmer');
  await farmerPage.click('button[type="submit"]');
  await expect(farmerPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await farmerPage.fill('#prod-name',  PRODUCT_NAME);
  await farmerPage.fill('#prod-price', '3');
  await farmerPage.fill('#prod-qty',   '20');
  await farmerPage.fill('#prod-unit',  'kg');
  await farmerPage.click('form button[type="submit"]:has-text("List Product")');
  await expect(farmerPage.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });
  await farmerCtx.close();

  // ── Buyer: register ─────────────────────────────────────────────────────────
  const buyerCtx  = await browser.newContext();
  const buyerPage = await buyerCtx.newPage();

  await buyerPage.goto('/register');
  await buyerPage.fill('#reg-name',     `Fav Buyer ${ts}`);
  await buyerPage.fill('#reg-email',    BUYER_EMAIL);
  await buyerPage.fill('#reg-password', PASS);
  await buyerPage.selectOption('#reg-role', 'buyer');
  await buyerPage.click('button[type="submit"]');
  await expect(buyerPage).toHaveURL(/\/marketplace/, { timeout: 15_000 });
  await buyerCtx.close();
});

// ─── test ─────────────────────────────────────────────────────────────────────

test.describe('Favorites persistence (#1046)', () => {
  test('favorite survives logout → login cycle (server-side persistence)', async ({ page }) => {
    // ── Step 1: Log in as buyer ─────────────────────────────────────────────
    await page.goto('/login');
    await page.fill('#login-email',    BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });

    // ── Step 2: Locate the product card ────────────────────────────────────
    await page.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await page.waitForTimeout(800); // debounce + search fetch
    const card = page.locator(`[aria-label="View ${PRODUCT_NAME}"]`).first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // ── Step 3: Favourite the product ──────────────────────────────────────
    // The favourite button sits inside the same card container.  Select it by
    // its title attribute which Marketplace.jsx sets explicitly.
    const addBtn = page.locator('[title="Add to favorites"]').first();
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // After clicking, optimistic update flips the title immediately;
    // the API call fires in the background.
    const removeBtn = page.locator('[title="Remove from favorites"]').first();
    await expect(removeBtn).toBeVisible({ timeout: 5_000 });

    // Wait for the API call to complete before logging out so we don't log
    // out before the favourite is written to the backend.
    await page.waitForTimeout(500);

    // ── Step 4: Log out ─────────────────────────────────────────────────────
    await page.click('button:has-text("Logout")');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // ── Step 5: Log back in ─────────────────────────────────────────────────
    await page.fill('#login-email',    BUYER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });

    // ── Step 6: Confirm the favourite is still set ──────────────────────────
    // FavoritesContext re-hydrates from api.getFavorites() on each login.
    // Give it a moment to fetch, then search for the product again.
    await page.fill('input[aria-label*="earch"]', PRODUCT_NAME);
    await page.waitForTimeout(800); // debounce + context re-hydration

    const removeBtnAfterLogin = page.locator('[title="Remove from favorites"]').first();
    await expect(removeBtnAfterLogin).toBeVisible({ timeout: 10_000 });

    // ── Cleanup: Un-favourite to leave DB clean ──────────────────────────────
    await removeBtnAfterLogin.click();
    await expect(
      page.locator('[title="Add to favorites"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
