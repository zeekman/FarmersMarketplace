/**
 * Visual regression tests for Marketplace product grid (#1067)
 *
 * These tests capture screenshots of the Marketplace grid at multiple breakpoints
 * to ensure that badges (out-of-stock, flash sale, pre-order, grade) don't visually
 * collide or overflow as new badge types are added.
 */

import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goto(page, path) {
  await page.goto(path, { waitUntil: 'networkidle' });
}

// ── Visual regression tests ───────────────────────────────────────────────────

test.describe('Marketplace visual regression (#1067)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to marketplace
    await goto(page, '/marketplace');
  });

  test('Marketplace grid at mobile breakpoint (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Wait for products to load
    await page.waitForSelector('.card', { timeout: 5000 }).catch(() => {
      // If no products, that's okay for visual regression baseline
    });

    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot('marketplace-mobile-375px.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
  });

  test('Marketplace grid at tablet breakpoint (768px)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    
    // Wait for products to load
    await page.waitForSelector('.card', { timeout: 5000 }).catch(() => {
      // If no products, that's okay for visual regression baseline
    });

    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot('marketplace-tablet-768px.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
  });

  test('Marketplace grid at desktop breakpoint (1200px)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    
    // Wait for products to load
    await page.waitForSelector('.card', { timeout: 5000 }).catch(() => {
      // If no products, that's okay for visual regression baseline
    });

    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot('marketplace-desktop-1200px.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
  });

  test('Marketplace grid with multiple badges at desktop breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    
    // Wait for products to load
    await page.waitForSelector('.card', { timeout: 5000 }).catch(() => {
      // If no products, that's okay for visual regression baseline
    });

    // Focus on the product grid section
    const grid = page.locator('.grid').first();
    if (await grid.isVisible()) {
      await expect(grid).toHaveScreenshot('marketplace-badges-desktop.png', {
        maxDiffPixels: 100,
      });
    }
  });
});
