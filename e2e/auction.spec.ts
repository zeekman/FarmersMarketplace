import { test, expect } from '@playwright/test';

const ts = Date.now();
const FARMER_EMAIL = `farmer_auction_${ts}@test.invalid`;
const BUYER_EMAIL = `buyer_auction_${ts}@test.invalid`;
const PASS = 'TestPass1!';
const PRODUCT_NAME = `E2E Auction Squash ${ts}`;
const START_PRICE = 5;
const BID_AMOUNT = 8.5;

function farFutureLocalDateTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000); // ends in 1 hour
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

test.describe('Auction bidding flow', () => {
  test('farmer creates an auction, buyer bids, and the updated leaderboard is reflected for both', async ({ browser }) => {
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
    await farmerPage.fill('#prod-price', '1');
    await farmerPage.fill('#prod-qty', '50');
    await farmerPage.fill('#prod-unit', 'kg');
    await farmerPage.click('form button[type="submit"]:has-text("List Product")');
    await expect(farmerPage.locator(`text=${PRODUCT_NAME}`)).toBeVisible({ timeout: 10_000 });

    // Create an auction for the product via the Dashboard's auction manager
    const auctionForm = farmerPage.locator('h3:has-text("Create Auction")').locator('..');
    await auctionForm.locator('select').selectOption({ label: PRODUCT_NAME });
    await auctionForm.locator('input[type="number"]').fill(String(START_PRICE));
    await auctionForm.locator('input[type="datetime-local"]').fill(farFutureLocalDateTime());
    await auctionForm.locator('button:has-text("Create Auction")').click();
    await expect(auctionForm.locator('text=Auction created!')).toBeVisible({ timeout: 10_000 });

    // Buyer registers, funds their wallet, and places a bid from the Marketplace
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
    const auctionCard = buyerPage
      .locator('div')
      .filter({ hasText: PRODUCT_NAME })
      .filter({ has: buyerPage.locator('button:has-text("Place Bid")') })
      .last();
    await expect(auctionCard).toBeVisible({ timeout: 10_000 });

    await auctionCard.locator('input[type="number"]').fill(String(BID_AMOUNT));
    await auctionCard.locator('button:has-text("Place Bid")').click();
    await expect(auctionCard.locator('text=✓ Bid placed!')).toBeVisible({ timeout: 10_000 });
    await expect(auctionCard.locator(`text=${BID_AMOUNT} XLM`)).toBeVisible();
    await expect(auctionCard.locator('text=1 bid')).toBeVisible();

    // The farmer sees the updated highest bid after refreshing the Marketplace
    await farmerPage.goto('/marketplace');
    const farmerAuctionCard = farmerPage
      .locator('div')
      .filter({ hasText: PRODUCT_NAME })
      .filter({ has: farmerPage.locator('button:has-text("Place Bid")') })
      .last();
    await expect(farmerAuctionCard.locator(`text=${BID_AMOUNT} XLM`)).toBeVisible({ timeout: 10_000 });
    await expect(farmerAuctionCard.locator('text=1 bid')).toBeVisible();

    await farmerCtx.close();
    await buyerCtx.close();
  });
});
