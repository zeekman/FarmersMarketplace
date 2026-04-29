const db = require('../db/schema');
const { sendPayment } = require('../utils/stellar');

async function closeExpiredAuctions() {
  const expired = db
    .prepare(
      `
    SELECT a.*, u.stellar_public_key as farmer_wallet
    FROM auctions a
    JOIN users u ON a.farmer_id = u.id
    WHERE a.status = 'active' AND a.ends_at <= datetime('now')
  `
    )
    .all();

  for (const auction of expired) {
    // Tie-breaking: highest amount wins; among equal bids, earliest created_at wins
    const winner = db
      .prepare(
        `SELECT b.buyer_id, b.amount, u.stellar_public_key as buyer_wallet, u.stellar_secret_key as buyer_secret
         FROM bids b
         JOIN users u ON b.buyer_id = u.id
         WHERE b.auction_id = ?
         ORDER BY b.amount DESC, b.created_at ASC
         LIMIT 1`
      )
      .get(auction.id);

    if (!winner) {
      // No bids — cancel
      db.prepare(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`).run(auction.id);
      console.log(`Auction #${auction.id} cancelled (no bids)`);
      continue;
    }

    try {
      const txHash = await sendPayment({
        senderSecret: winner.buyer_secret,
        receiverPublicKey: auction.farmer_wallet,
        amount: winner.amount,
        memo: `Auction#${auction.id}`,
      });

      db.prepare(`UPDATE auctions SET status = 'closed' WHERE id = ?`).run(auction.id);
      db.prepare(
        'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, stellar_tx_hash) VALUES (?, ?, 1, ?, ?, ?)'
      ).run(winner.buyer_id, auction.product_id, winner.amount, 'paid', txHash);

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
