import { test, expect } from '@playwright/test';

// Issue #1403: the service worker must never serve one user's authenticated
// API responses to the next user on a shared device. This test logs in as A,
// loads the wallet, logs out, goes offline, logs in as B, and asserts that A's
// data never appears.

const USER_A = {
  email: 'alice@example.com',
  password: 'alice-password',
  walletBalance: '1111.11',
  orderId: 'ORDER-ALICE-0001',
};

const USER_B = {
  email: 'bob@example.com',
  password: 'bob-password',
  walletBalance: '2222.22',
  orderId: 'ORDER-BOB-0002',
};

async function login(page, user) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function logout(page) {
  await page.getByRole('button', { name: /log ?out|sign ?out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe('authenticated API cache isolation', () => {
  test('user A data is never served to user B after logout', async ({ page, context }) => {
    // --- User A: log in and load the wallet so the SW has a chance to cache it.
    await login(page, USER_A);
    await page.goto('/wallet');
    await expect(page.getByText(USER_A.walletBalance)).toBeVisible();

    // --- Log out: logout() must post CLEAR_USER_CACHE to the SW.
    await logout(page);

    // --- Go offline so any cached response would be served instead of the network.
    await context.setOffline(true);

    // --- User B: log in while offline. The SW must not fall back to A's cache.
    await login(page, USER_B);
    await page.goto('/wallet');

    // A's data must never appear for B.
    await expect(page.getByText(USER_A.walletBalance)).toHaveCount(0);
    await expect(page.getByText(USER_A.orderId)).toHaveCount(0);
    await expect(page.getByText(USER_A.email)).toHaveCount(0);

    await context.setOffline(false);
  });

  test('service worker does not cache authenticated API responses', async ({ page }) => {
    await login(page, USER_A);
    await page.goto('/wallet');
    await expect(page.getByText(USER_A.walletBalance)).toBeVisible();

    const cachedAuthUrls = await page.evaluate(async () => {
      const names = await caches.keys();
      const hits = [];
      for (const name of names) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        for (const request of requests) {
          const url = new URL(request.url);
          if (url.pathname.startsWith('/api/')) {
            hits.push(url.pathname);
          }
        }
      }
      return hits;
    });

    // Only allowlisted public endpoints may be cached; authenticated paths must not be.
    const forbidden = cachedAuthUrls.filter(
      (path) =>
        !path.startsWith('/api/v1/products') &&
        !path.startsWith('/api/v1/categories') &&
        !path.startsWith('/api/v1/rates')
    );
    expect(forbidden).toEqual([]);
  });
});
