'use strict';

const db = require('../db/schema');
const { sendPayment } = require('../utils/stellar');
const mailer = require('../utils/mailer');
const logger = require('../logger');

async function closeExpiredAuctions() {
  let expired;

  if (db.isPostgres) {
    const { rows } = await db.query(
      `SELECT a.*, u.stellar_public_key AS farmer_wallet, u.email AS farmer_email, u.name AS farmer_name
       FROM auctions a
       JOIN users u ON a.farmer_id = u.id
       WHERE a.status = 'active' AND a.ends_at <= NOW()`
    );
    expired = rows;
  } else {
    expired = db
      .prepare(
        `SELECT a.*, u.stellar_public_key AS farmer_wallet, u.email AS farmer_email, u.name AS farmer_name
         FROM auctions a
         JOIN users u ON a.farmer_id = u.id
         WHERE a.status = 'active' AND a.ends_at <= datetime('now')`
      )
      .all();
  }

  for (const auction of expired) {
    let winner;

    if (db.isPostgres) {
      const { rows } = await db.query(
        `SELECT b.buyer_id, b.amount,
                u.stellar_public_key AS buyer_wallet,
                u.stellar_secret_key AS buyer_secret,
                u.email AS buyer_email, u.name AS buyer_name
         FROM bids b
         JOIN users u ON b.buyer_id = u.id
         WHERE b.auction_id = $1
         ORDER BY b.amount DESC, b.created_at ASC
         LIMIT 1`,
        [auction.id]
      );
      winner = rows[0];
    } else {
      winner = db
        .prepare(
          `SELECT b.buyer_id, b.amount,
                  u.stellar_public_key AS buyer_wallet,
                  u.stellar_secret_key AS buyer_secret,
                  u.email AS buyer_email, u.name AS buyer_name
           FROM bids b
           JOIN users u ON b.buyer_id = u.id
           WHERE b.auction_id = ?
           ORDER BY b.amount DESC, b.created_at ASC
           LIMIT 1`
        )
        .get(auction.id);
    }

    if (!winner) {
      // No bids — cancel
      if (db.isPostgres) {
        await db.query(`UPDATE auctions SET status = 'cancelled' WHERE id = $1`, [auction.id]);
      } else {
        db.prepare(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`).run(auction.id);
      }
      logger.info(`[auctionCron] Auction #${auction.id} cancelled (no bids)`);
      continue;
    }

    // Check reserve_price
    const reserveMet =
      auction.reserve_price === null ||
      auction.reserve_price === undefined ||
      winner.amount >= auction.reserve_price;

    if (!reserveMet) {
      // Highest bid is below reserve — end with no sale
      if (db.isPostgres) {
        await db.query(
          `UPDATE auctions SET status = 'ended_no_sale', winner_notified = 1 WHERE id = $1`,
          [auction.id]
        );
      } else {
        db.prepare(
          `UPDATE auctions SET status = 'ended_no_sale', winner_notified = 1 WHERE id = ?`
        ).run(auction.id);
      }

      // Notify all bidders
      let bidders;
      if (db.isPostgres) {
        const { rows } = await db.query(
          `SELECT DISTINCT u.email, u.name
           FROM bids b JOIN users u ON b.buyer_id = u.id
           WHERE b.auction_id = $1`,
          [auction.id]
        );
        bidders = rows;
      } else {
        bidders = db
          .prepare(
            `SELECT DISTINCT u.email, u.name
             FROM bids b JOIN users u ON b.buyer_id = u.id
             WHERE b.auction_id = ?`
          )
          .all(auction.id);
      }

      for (const bidder of bidders) {
        await mailer.sendAuctionNoSaleEmail({ bidder, auction }).catch(() => {});
      }

      logger.info(`[auctionCron] Auction #${auction.id} ended_no_sale (reserve not met)`);
      continue;
    }

    // Reserve met (or no reserve) — process winner
    try {
      const txHash = await sendPayment({
        senderSecret: winner.buyer_secret,
        receiverPublicKey: auction.farmer_wallet,
        amount: winner.amount,
        memo: `Auction#${auction.id}`,
      });

      if (db.isPostgres) {
        await db.query(
          `UPDATE auctions SET status = 'ended', winner_id = $1, winner_notified = 1,
                               closed_at = NOW() WHERE id = $2`,
          [winner.buyer_id, auction.id]
        );
        await db.query(
          `INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, stellar_tx_hash)
           VALUES ($1, $2, 1, $3, 'paid', $4)`,
          [winner.buyer_id, auction.product_id, winner.amount, txHash]
        );
      } else {
        db.prepare(
          `UPDATE auctions SET status = 'ended', winner_id = ?, winner_notified = 1,
                               closed_at = datetime('now') WHERE id = ?`
        ).run(winner.buyer_id, auction.id);
        db.prepare(
          `INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, stellar_tx_hash)
           VALUES (?, ?, 1, ?, 'paid', ?)`
        ).run(winner.buyer_id, auction.product_id, winner.amount, txHash);
      }

      // Notify winner and farmer
      await mailer
        .sendAuctionWinnerEmail({ winner, auction, txHash })
        .catch(() => {});
      await mailer
        .sendAuctionSaleEmail({ farmer: auction, winner, txHash })
        .catch(() => {});

      logger.info(`[auctionCron] Auction #${auction.id} ended. Winner: ${winner.buyer_id} TX: ${txHash}`);
    } catch (e) {
      logger.error(`[auctionCron] Auction #${auction.id} payment failed: ${e.message}`);
      if (db.isPostgres) {
        await db.query(`UPDATE auctions SET status = 'cancelled' WHERE id = $1`, [auction.id]);
      } else {
        db.prepare(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`).run(auction.id);
      }
    }
  }
}

// Run every minute
setInterval(() => {
  closeExpiredAuctions().catch((e) =>
    logger.error('[auctionCron] Job error', { message: e.message })
  );
}, 60 * 1000);

// Also run once on startup
closeExpiredAuctions().catch((e) =>
  logger.error('[auctionCron] Startup error', { message: e.message })
);

module.exports = { closeExpiredAuctions };
