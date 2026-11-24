/**
 * Freighter non-custodial checkout (FE-15).
 *
 * Needs a browser profile with the Freighter extension loaded, which CI does
 * not have, so the test is skipped unless FREIGHTER_EXTENSION_PATH is set.
 */
import { test, expect } from '@playwright/test';

const extensionAvailable = Boolean(process.env.FREIGHTER_EXTENSION_PATH);

test.describe('Freighter checkout', { tag: '@flow' }, () => {
  test.skip(!extensionAvailable, 'Freighter extension is not available in this environment');

  test('wallet page offers to connect Freighter', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page.getByTestId('freighter-connect')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
  });
});
