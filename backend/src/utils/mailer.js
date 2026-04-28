const nodemailer = require('nodemailer');
const logger = require('../logger');

// Check if SMTP is configured
const SMTP_CONFIGURED = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

if (!SMTP_CONFIGURED) {
  logger.warn('[mailer] SMTP not configured — emails will be skipped');
}

const transporter = SMTP_CONFIGURED
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

async function sendOrderEmails({ order, product, buyer, farmer }) {
  if (!SMTP_CONFIGURED) return; // skip if not configured

  const subject = `Order #${order.id} Confirmed – ${product.name}`;
  const summary = `
Product:  ${product.name} (${product.category})
Quantity: ${order.quantity} ${product.unit}
Total:    ${order.total_price} XLM
TX Hash:  ${order.stellar_tx_hash}
Date:     ${new Date().toUTCString()}
`.trim();

  await Promise.all([
    transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: buyer.email,
      subject,
      text: `Hi ${buyer.name},\n\nYour order has been confirmed!\n\n${summary}\n\nDelivery instructions: Contact the farmer (${farmer.name}) to arrange delivery.\n\nThank you for shopping at Farmers Marketplace!`,
    }),
    transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: farmer.email,
      subject: `New Sale #${order.id} – ${product.name}`,
      text: `Hi ${farmer.name},\n\nYou have a new sale!\n\nBuyer: ${buyer.name} (${buyer.email})\n\n${summary}\n\nPlease arrange delivery with the buyer at your earliest convenience.\n\nFarmers Marketplace`,
    }),
  ]);
}

async function sendLowStockAlert({ product, farmer }) {
  if (!SMTP_CONFIGURED) return;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: farmer.email,
    subject: `⚠️ Low Stock Alert – ${product.name}`,
    text: `Hi ${farmer.name},\n\nYour product "${product.name}" is running low on stock.\n\nCurrent quantity: ${product.quantity} ${product.unit}\nThreshold: ${product.low_stock_threshold} ${product.unit}\n\nPlease restock or update your listing.\n\nFarmers Marketplace`,
  });
}

async function sendStatusUpdateEmail({ order, product, buyer, newStatus }) {
  if (!SMTP_CONFIGURED) return;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: buyer.email,
    subject: `Order #${order.id} Status Update – ${newStatus.toUpperCase()}`,
    text: `Hi ${buyer.name},\n\nYour order status has been updated.\n\nOrder #${order.id}\nProduct: ${product.name}\nNew Status: ${newStatus}\n\nThank you for shopping at Farmers Marketplace!`,
  });
}

async function sendFreshnessAlert({ product, farmer, daysLeft }) {
  if (!SMTP_CONFIGURED) return;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: farmer.email,
    subject: `⚠️ Product Expiring Soon – ${product.name}`,
    text: `Hi ${farmer.name},\n\nYour product "${product.name}" is approaching its best-before date.\n\nBest Before: ${product.best_before}\nDays Left: ${daysLeft}\n\nPlease consider updating the listing or removing it from sale.\n\nFarmers Marketplace`,
  });
}

async function sendReturnEmail({ type, order, buyer, farmer, reason, txHash, rejectReason }) {
  if (!SMTP_CONFIGURED) return;
  if (type === 'filed') {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: farmer.email,
      subject: `↩️ Return Request – Order #${order.id} (${order.product_name})`,
      text: `Hi ${farmer.name},\n\nBuyer ${buyer.name} has filed a return request for Order #${order.id}.\n\nReason: ${reason}\n\nPlease log in to approve or reject this request.\n\nFarmers Marketplace`,
    });
  } else if (type === 'approved') {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: buyer.email,
      subject: `✅ Return Approved – Order #${order.id} (${order.product_name})`,
      text: `Hi ${buyer.name},\n\nYour return request for Order #${order.id} has been approved.\n\nRefund of ${order.total_price} XLM has been sent.\nTX Hash: ${txHash}\n\nFarmers Marketplace`,
    });
  } else if (type === 'rejected') {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: buyer.email,
      subject: `❌ Return Rejected – Order #${order.id} (${order.product_name})`,
      text: `Hi ${buyer.name},\n\nYour return request for Order #${order.id} has been rejected.${rejectReason ? `\n\nReason: ${rejectReason}` : ''}\n\nFarmers Marketplace`,
    });
  }
}

async function sendContractAlert({ to, alert }) {
  if (!SMTP_CONFIGURED) return;
  const typeLabel = alert.alert_type === 'failed_invocations' ? '⚠️ Failed Invocations' : '🚨 Large Transfer';
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `[Contract Alert] ${typeLabel} – ${alert.contract_id}`,
    text: `Admin Alert\n\nType: ${alert.alert_type}\nContract: ${alert.contract_id}\n\n${alert.message}\n\nTime: ${alert.created_at}\n\nLog in to the admin dashboard to acknowledge this alert.\n\nFarmers Marketplace`,
  });
}

module.exports = {
  transporter,
  sendOrderEmails,
  sendLowStockAlert,
  sendStatusUpdateEmail,
  sendBackInStockEmail: async () => {
    if (!SMTP_CONFIGURED) return;
    // Placeholder for back in stock email
  },
  sendReturnEmail,
  sendContractAlert,
};
