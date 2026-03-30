const db = require('../db/schema');
const { sendPayment } = require('../utils/stellar');

async function closeExpiredAuctions() {
  const expired = db
    .prepare(
      `
    SELECT a.*, u.stellar_public_key as farmer_wallet,
           b.stellar_public_key as buyer_wallet,
           b.stellar_secret_key as buyer_secret
    FROM auctions a
    JOIN users u ON a.farmer_id = u.id
    LEFT JOIN users b ON a.highest_bidder_id = b.id
    WHERE a.status = 'active' AND a.ends_at <= datetime('now')
  `
    )
    .all();

  for (const auction of expired) {
    if (!auction.highest_bidder_id) {
      // No bids — cancel
      db.prepare(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`).run(auction.id);
      console.log(`Auction #${auction.id} cancelled (no bids)`);
      continue;
    }

    try {
      const txHash = await sendPayment({
        senderSecret: auction.buyer_secret,
        receiverPublicKey: auction.farmer_wallet,
        amount: auction.current_bid,
        memo: `Auction#${auction.id}`,
      });

      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(auction.product_id);

      db.prepare(`UPDATE auctions SET status = 'closed' WHERE id = ?`).run(auction.id);
      db.prepare(
        'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, stellar_tx_hash) VALUES (?, ?, 1, ?, ?, ?)'
      ).run(auction.highest_bidder_id, auction.product_id, auction.current_bid, 'paid', txHash);

      console.log(`Auction #${auction.id} closed. TX: ${txHash}`);
    } catch (e) {
      console.error(`Auction #${auction.id} payment failed:`, e.message);
      db.prepare(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`).run(auction.id);
    }
  }
}

// Run every minute
setInterval(closeExpiredAuctions, 60 * 1000);
// Also run once on startup
closeExpiredAuctions();

module.exports = { closeExpiredAuctions };
