const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOrderEmails({ order, product, buyer, farmer }) {
  if (!process.env.SMTP_HOST) return; // skip if not configured

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

async function sendBackInStockEmail({ user, product }) {
  if (!process.env.SMTP_HOST) return;
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: user.email,
    subject: `Back in stock: ${product.name}`,
    text: `Hi ${user.name},\n\n${product.name} is available again! Visit /products/${product.id} to order.\n\nFarmers Marketplace`,
  });
}

// Sends a push notification to a single user via their stored Web Push subscription.
// Falls back to a no-op if the user has no subscription or push is not configured.
async function sendPushToUser({ subscription, payload }) {
  if (!subscription) return;
  // Dynamic require keeps push optional — only errors if actually called without the package.
  const webpush = require('web-push');
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

module.exports = { sendOrderEmails, sendBackInStockEmail, sendPushToUser };
