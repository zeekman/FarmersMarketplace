'use strict';

const router = require('express').Router();
const PDFDocument = require('pdfkit');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// GET /api/orders/:id/receipt.pdf — buyer, farmer, and admins only
router.get('/:id/receipt.pdf', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT o.id, o.buyer_id, o.quantity, o.total_price, o.status, o.stellar_tx_hash,
            o.settlement_tx_hash, o.settlement_type, o.settled_at,
            o.created_at, p.name AS product_name, p.unit,
            buyer.name AS buyer_name, buyer.email AS buyer_email,
            farmer.id AS farmer_id, farmer.name AS farmer_name, farmer.email AS farmer_email
     FROM orders o
     JOIN products p ON p.id = o.product_id
     JOIN users buyer ON buyer.id = o.buyer_id
     JOIN users farmer ON farmer.id = p.farmer_id
     WHERE o.id = $1`,
    [req.params.id]
  );
  const order = rows[0];
  if (!order) return err(res, 404, 'Order not found', 'not_found');
  if (req.user.role !== 'admin' && req.user.id !== order.buyer_id && req.user.id !== order.farmer_id) {
    return err(res, 403, 'Forbidden', 'forbidden');
  }

  const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';
  const explorerUrl = order.stellar_tx_hash
    ? `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(order.stellar_tx_hash)}`
    : null;
  const settlementExplorerUrl = order.settlement_tx_hash
    ? `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(order.settlement_tx_hash)}`
    : null;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="order-${order.id}-receipt.pdf"`);
  const document = new PDFDocument({ margin: 50, size: 'A4' });
  document.pipe(res);
  document.fontSize(20).fillColor('#2d6a4f').text('Farmers Marketplace', { align: 'center' });
  document.moveDown(0.4).fontSize(15).fillColor('#222').text(`Order receipt #${order.id}`, { align: 'center' });
  document.moveDown().fontSize(10).fillColor('#555').text(`Issued: ${new Date().toISOString()}`, { align: 'center' });
  document.moveDown(1.5).fillColor('#222').fontSize(11);
  document.text(`Product: ${order.product_name}`);
  document.text(`Quantity: ${order.quantity}${order.unit ? ` ${order.unit}` : ''}`);
  document.text(`Total: ${order.total_price} XLM`);
  document.text(`Status: ${order.status}`);
  document.text(`Buyer: ${order.buyer_name} (${order.buyer_email})`);
  document.text(`Farmer: ${order.farmer_name} (${order.farmer_email})`);
  document.moveDown();
  document.text(`Stellar transaction: ${order.stellar_tx_hash || 'Not yet available'}`);
  if (explorerUrl) document.fillColor('#075985').text(`Explorer: ${explorerUrl}`);
  if (order.settlement_tx_hash) {
    document.fillColor('#222').text(
      `Settlement (${order.settlement_type || 'escrow'}): ${order.settlement_tx_hash}`
    );
    if (settlementExplorerUrl) document.fillColor('#075985').text(`Explorer: ${settlementExplorerUrl}`);
  }
  document.end();
});

module.exports = router;
