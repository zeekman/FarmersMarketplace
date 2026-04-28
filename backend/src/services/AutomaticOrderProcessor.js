/**
 * AutomaticOrderProcessor - Handles automatic order creation and processing for waitlist entries
 *
 * Integrates with existing order processing system, payment infrastructure, and notification system.
 * Processes waitlist entries in FIFO order when products are restocked.
 *
 * Validates: Requirements 2.2, 2.3
 */

const db = require('../db/schema');
const { sendPayment, getBalance } = require('../utils/stellar');
const { sendOrderEmails } = require('../utils/mailer');

class AutomaticOrderProcessor {
  /**
   * Create an automatic order for a waitlist entry
   * @param {Object} waitlistEntry - The waitlist entry to process
   * @param {Object} product - The product details
   * @param {Object} buyer - The buyer details
   * @returns {Promise<{success: boolean, orderId?: number, error?: string, code?: string}>}
   */
  async createAutomaticOrder(waitlistEntry, product, buyer) {
    // Enhanced input validation
    const validation = this._validateOrderInputs(waitlistEntry, product, buyer);
    if (!validation.isValid) {
      return { success: false, error: validation.error, code: 'INVALID_INPUT' };
    }

    try {
      // Check if buyer has sufficient balance
      const balance = await getBalance(buyer.stellar_public_key);
      const totalPrice = parseFloat((product.price * waitlistEntry.quantity).toFixed(7));
      const required = totalPrice + 0.00001; // Add transaction fee

      if (balance < required) {
        return {
          success: false,
          error: `Insufficient XLM balance. Required: ${required.toFixed(7)}, Available: ${balance.toFixed(7)}`,
          code: 'INSUFFICIENT_BALANCE',
          requiredBalance: required,
          availableBalance: balance,
        };
      }

      // Get farmer details
      const { rows: farmerRows } = await db.query(
        'SELECT id, name, email, stellar_public_key FROM users WHERE id = $1',
        [product.farmer_id]
      );
      const farmer = farmerRows[0];

      if (!farmer || !farmer.stellar_public_key) {
        return {
          success: false,
          error: 'Farmer wallet not configured',
          code: 'FARMER_WALLET_ERROR',
        };
      }

      // Create order and process payment in transaction
      const orderResult = await this._createOrderWithPayment({
        waitlistEntry,
        product,
        buyer,
        farmer,
        totalPrice,
      });

      if (!orderResult.success) {
        return orderResult;
      }

      // Send notifications (don't fail the order if notifications fail)
      this._sendOrderNotifications({
        order: orderResult.order,
        product,
        buyer,
        farmer,
        isAutomatic: true,
      }).catch((error) => {
        console.error('[AutomaticOrderProcessor] Notification failed:', error.message);
      });

      return {
        success: true,
        orderId: orderResult.order.id,
        txHash: orderResult.order.stellar_tx_hash,
        totalPrice,
        code: 'ORDER_CREATED',
      };
    } catch (error) {
      console.error('[AutomaticOrderProcessor] Error creating automatic order:', error);
      return {
        success: false,
        error: 'Failed to create automatic order: ' + error.message,
        code: 'INTERNAL_ERROR',
      };
    }
  }

  /**
   * Validate inputs for order creation
   * @private
   */
  _validateOrderInputs(waitlistEntry, product, buyer) {
    const errors = [];

    // Validate waitlist entry
    if (!waitlistEntry || typeof waitlistEntry !== 'object') {
      errors.push('waitlistEntry is required and must be an object');
    } else {
      if (!waitlistEntry.id || !Number.isInteger(waitlistEntry.id)) {
        errors.push('waitlistEntry.id must be a valid integer');
      }
      if (!waitlistEntry.buyer_id || !Number.isInteger(waitlistEntry.buyer_id)) {
        errors.push('waitlistEntry.buyer_id must be a valid integer');
      }
      if (!waitlistEntry.product_id || !Number.isInteger(waitlistEntry.product_id)) {
        errors.push('waitlistEntry.product_id must be a valid integer');
      }
      if (
        !waitlistEntry.quantity ||
        !Number.isInteger(waitlistEntry.quantity) ||
        waitlistEntry.quantity <= 0
      ) {
        errors.push('waitlistEntry.quantity must be a positive integer');
      }
    }

    // Validate product
    if (!product || typeof product !== 'object') {
      errors.push('product is required and must be an object');
    } else {
      if (!product.id || !Number.isInteger(product.id)) {
        errors.push('product.id must be a valid integer');
      }
      if (!product.farmer_id || !Number.isInteger(product.farmer_id)) {
        errors.push('product.farmer_id must be a valid integer');
      }
      if (typeof product.price !== 'number' || product.price <= 0) {
        errors.push('product.price must be a positive number');
      }
      if (!product.name || typeof product.name !== 'string') {
        errors.push('product.name must be a non-empty string');
      }
    }

    // Validate buyer
    if (!buyer || typeof buyer !== 'object') {
      errors.push('buyer is required and must be an object');
    } else {
      if (!buyer.id || !Number.isInteger(buyer.id)) {
        errors.push('buyer.id must be a valid integer');
      }
      if (!buyer.stellar_public_key || typeof buyer.stellar_public_key !== 'string') {
        errors.push('buyer.stellar_public_key must be a valid string');
      }
      if (!buyer.stellar_secret_key || typeof buyer.stellar_secret_key !== 'string') {
        errors.push('buyer.stellar_secret_key must be a valid string');
      }
      if (!buyer.name || typeof buyer.name !== 'string') {
        errors.push('buyer.name must be a non-empty string');
      }
      if (!buyer.email || typeof buyer.email !== 'string') {
        errors.push('buyer.email must be a valid string');
      }
    }

    return {
      isValid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
    };
  }

  /**
   * Create order and process payment atomically
   * @private
   */
  async _createOrderWithPayment({ waitlistEntry, product, buyer, farmer, totalPrice }) {
    // Start database transaction
    await db.query('BEGIN');

    try {
      // Reserve stock atomically
      const { rowCount } = await db.query(
        'UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1',
        [waitlistEntry.quantity, product.id]
      );

      if (rowCount === 0) {
        await db.query('ROLLBACK');
        return {
          success: false,
          error: 'Insufficient stock available',
          code: 'INSUFFICIENT_STOCK',
        };
      }

      // Create order record
      const { rows: orderRows } = await db.query(
        `INSERT INTO orders (buyer_id, product_id, quantity, total_price, status, created_at) 
         VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP) 
         RETURNING id, buyer_id, product_id, quantity, total_price, status, created_at`,
        [buyer.id, product.id, waitlistEntry.quantity, totalPrice]
      );

      const order = orderRows[0];

      // Process payment
      const paymentResult = await this.processPayment(order, buyer, farmer);

      if (!paymentResult.success) {
        // Rollback stock and order
        await db.query('ROLLBACK');
        return paymentResult;
      }

      // Update order with payment details
      await db.query('UPDATE orders SET status = $1, stellar_tx_hash = $2 WHERE id = $3', [
        'paid',
        paymentResult.txHash,
        order.id,
      ]);

      // Commit transaction
      await db.query('COMMIT');

      return {
        success: true,
        order: {
          ...order,
          status: 'paid',
          stellar_tx_hash: paymentResult.txHash,
        },
        txHash: paymentResult.txHash,
      };
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Process payment for an automatic order
   * @param {Object} order - The order details
   * @param {Object} buyer - The buyer details
   * @param {Object} farmer - The farmer details
   * @returns {Promise<{success: boolean, txHash?: string, error?: string, code?: string}>}
   */
  async processPayment(order, buyer, farmer) {
    // Enhanced input validation
    const validation = this._validatePaymentInputs(order, buyer, farmer);
    if (!validation.isValid) {
      return { success: false, error: validation.error, code: 'INVALID_INPUT' };
    }

    try {
      // Double-check balance before payment
      const balance = await getBalance(buyer.stellar_public_key);
      const required = order.total_price + 0.00001;

      if (balance < required) {
        return {
          success: false,
          error: `Insufficient balance for payment. Required: ${required.toFixed(7)}, Available: ${balance.toFixed(7)}`,
          code: 'INSUFFICIENT_BALANCE',
        };
      }

      // Send payment using existing stellar utility
      const txHash = await sendPayment({
        senderSecret: buyer.stellar_secret_key,
        receiverPublicKey: farmer.stellar_public_key,
        amount: order.total_price,
        memo: `AutoOrder#${order.id}`,
      });

      return {
        success: true,
        txHash,
        code: 'PAYMENT_SUCCESS',
      };
    } catch (error) {
      console.error('[AutomaticOrderProcessor] Payment failed:', error);

      // Handle specific Stellar errors
      if (error.code === 'account_not_found') {
        return {
          success: false,
          error: 'Buyer wallet not found or unfunded',
          code: 'UNFUNDED_ACCOUNT',
        };
      }

      return {
        success: false,
        error: 'Payment failed: ' + error.message,
        code: 'PAYMENT_FAILED',
      };
    }
  }

  /**
   * Validate inputs for payment processing
   * @private
   */
  _validatePaymentInputs(order, buyer, farmer) {
    const errors = [];

    // Validate order
    if (!order || typeof order !== 'object') {
      errors.push('order is required and must be an object');
    } else {
      if (!order.id || !Number.isInteger(order.id)) {
        errors.push('order.id must be a valid integer');
      }
      if (typeof order.total_price !== 'number' || order.total_price <= 0) {
        errors.push('order.total_price must be a positive number');
      }
    }

    // Validate buyer
    if (!buyer || typeof buyer !== 'object') {
      errors.push('buyer is required and must be an object');
    } else {
      if (!buyer.stellar_public_key || typeof buyer.stellar_public_key !== 'string') {
        errors.push('buyer.stellar_public_key must be a valid string');
      }
      if (!buyer.stellar_secret_key || typeof buyer.stellar_secret_key !== 'string') {
        errors.push('buyer.stellar_secret_key must be a valid string');
      }
    }

    // Validate farmer
    if (!farmer || typeof farmer !== 'object') {
      errors.push('farmer is required and must be an object');
    } else {
      if (!farmer.stellar_public_key || typeof farmer.stellar_public_key !== 'string') {
        errors.push('farmer.stellar_public_key must be a valid string');
      }
    }

    return {
      isValid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
    };
  }

  /**
   * Send notifications for successful automatic order
   * @private
   */
  async _sendOrderNotifications({ order, product, buyer, farmer, isAutomatic = false }) {
    try {
      // Use existing email notification system with automatic order context
      await sendOrderEmails({
        order: {
          id: order.id,
          quantity: order.quantity,
          total_price: order.total_price,
          stellar_tx_hash: order.stellar_tx_hash,
        },
        product: {
          name: product.name,
          category: product.category || 'other',
          unit: product.unit || 'unit',
        },
        buyer: {
          name: buyer.name,
          email: buyer.email,
        },
        farmer: {
          name: farmer.name,
          email: farmer.email,
        },
      });

      // Log successful notification
      console.log(
        `[AutomaticOrderProcessor] Notifications sent for ${isAutomatic ? 'automatic' : 'manual'} order #${order.id}`
      );
    } catch (error) {
      console.error('[AutomaticOrderProcessor] Failed to send notifications:', error);
      // Don't throw - notifications are not critical for order success
    }
  }

  /**
   * Send notification for insufficient stock scenario
   * @param {Object} waitlistEntry - The waitlist entry that couldn't be processed
   * @param {Object} product - The product details
   * @param {Object} buyer - The buyer details
   * @param {number} availableStock - The available stock quantity
   * @returns {Promise<void>}
   */
  async notifyInsufficientStock(waitlistEntry, product, buyer, availableStock) {
    // Enhanced input validation
    if (!waitlistEntry || !product || !buyer) {
      console.error('[AutomaticOrderProcessor] Invalid inputs for insufficient stock notification');
      return;
    }

    try {
      // Send custom email for insufficient stock scenario
      const nodemailer = require('nodemailer');

      if (!process.env.SMTP_HOST) {
        console.warn(
          '[AutomaticOrderProcessor] SMTP not configured - skipping insufficient stock notification'
        );
        return;
      }

      const transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const subject = `Waitlist Update - ${product.name}`;
      const message = `Hi ${buyer.name},

We have good news and not-so-good news about "${product.name}" on your waitlist.

Good news: The product has been restocked!
Not-so-good news: There wasn't enough stock to fulfill your requested quantity.

Your waitlist request: ${waitlistEntry.quantity} ${product.unit || 'units'}
Available stock: ${availableStock} ${product.unit || 'units'}

Your position on the waitlist has been preserved, and you'll be notified when more stock becomes available.

You can also visit the marketplace to purchase the available quantity if you'd like.

Thank you for your patience!

Farmers Marketplace`;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: buyer.email,
        subject,
        text: message,
      });

      console.log(
        `[AutomaticOrderProcessor] Insufficient stock notification sent to ${buyer.email} for product #${product.id}`
      );
    } catch (error) {
      console.error(
        '[AutomaticOrderProcessor] Failed to send insufficient stock notification:',
        error
      );
    }
  }

  /**
   * Process waitlist entries when product is restocked
   * @param {number} productId - The product that was restocked
   * @param {number} availableQuantity - The quantity available for processing
   * @returns {Promise<{success: boolean, processed: number, skipped: number, errors: Array}>}
   */
  async processWaitlistOnRestock(productId, availableQuantity) {
    // Enhanced input validation
    if (!productId || !Number.isInteger(productId) || productId <= 0) {
      return {
        success: false,
        error: 'product_id must be a positive integer',
        code: 'INVALID_INPUT',
      };
    }

    if (!availableQuantity || !Number.isInteger(availableQuantity) || availableQuantity <= 0) {
      return {
        success: false,
        error: 'availableQuantity must be a positive integer',
        code: 'INVALID_INPUT',
      };
    }

    try {
      // Get product details
      const { rows: productRows } = await db.query(
        'SELECT * FROM products WHERE id = $1 AND is_active = true',
        [productId]
      );

      if (!productRows[0]) {
        return {
          success: false,
          error: 'Product not found or inactive',
          code: 'PRODUCT_NOT_FOUND',
        };
      }

      const product = productRows[0];

      // Get waitlist entries in FIFO order
      const { rows: waitlistRows } = await db.query(
        `SELECT we.*, u.name as buyer_name, u.email as buyer_email, 
                u.stellar_public_key, u.stellar_secret_key
         FROM waitlist_entries we
         JOIN users u ON we.buyer_id = u.id
         WHERE we.product_id = $1 AND u.is_active = true
         ORDER BY we.position ASC`,
        [productId]
      );

      let remainingStock = availableQuantity;
      let processed = 0;
      let skipped = 0;
      const errors = [];
      const processedEntries = [];

      // Process each waitlist entry in FIFO order
      for (const entry of waitlistRows) {
        if (remainingStock <= 0) {
          break; // No more stock available
        }

        // Check if we have enough stock for this entry
        if (entry.quantity > remainingStock) {
          // Skip this entry - not enough stock
          skipped++;

          // Notify buyer about insufficient stock
          this.notifyInsufficientStock(
            entry,
            product,
            {
              name: entry.buyer_name,
              email: entry.buyer_email,
            },
            remainingStock
          ).catch((error) => {
            console.error('[AutomaticOrderProcessor] Notification error:', error);
          });

          continue;
        }

        // Try to create automatic order
        const orderResult = await this.createAutomaticOrder(entry, product, {
          id: entry.buyer_id,
          name: entry.buyer_name,
          email: entry.buyer_email,
          stellar_public_key: entry.stellar_public_key,
          stellar_secret_key: entry.stellar_secret_key,
        });

        if (orderResult.success) {
          // Order created successfully
          processed++;
          remainingStock -= entry.quantity;
          processedEntries.push(entry.id);

          // Remove waitlist entry
          await db.query('DELETE FROM waitlist_entries WHERE id = $1', [entry.id]);

          console.log(
            `[AutomaticOrderProcessor] Processed waitlist entry #${entry.id}, order #${orderResult.orderId}`
          );
        } else {
          // Order creation failed
          skipped++;
          errors.push({
            entryId: entry.id,
            buyerId: entry.buyer_id,
            error: orderResult.error,
            code: orderResult.code,
          });

          console.error(
            `[AutomaticOrderProcessor] Failed to process waitlist entry #${entry.id}:`,
            orderResult.error
          );
        }
      }

      // Recalculate positions for remaining entries
      if (processedEntries.length > 0) {
        await this._recalculateWaitlistPositions(productId);
      }

      return {
        success: true,
        processed,
        skipped,
        errors,
        remainingStock,
        totalEntries: waitlistRows.length,
        code: 'PROCESSING_COMPLETE',
      };
    } catch (error) {
      console.error('[AutomaticOrderProcessor] Error processing waitlist on restock:', error);
      return {
        success: false,
        error: 'Failed to process waitlist: ' + error.message,
        code: 'INTERNAL_ERROR',
      };
    }
  }

  /**
   * Recalculate waitlist positions after processing
   * @private
   */
  async _recalculateWaitlistPositions(productId) {
    try {
      await db.query('BEGIN');

      // Get remaining entries ordered by created_at
      const { rows } = await db.query(
        `SELECT we.id 
         FROM waitlist_entries we
         JOIN users u ON we.buyer_id = u.id
         WHERE we.product_id = $1 AND u.is_active = true
         ORDER BY we.created_at ASC`,
        [productId]
      );

      // Update positions sequentially
      for (let i = 0; i < rows.length; i++) {
        await db.query('UPDATE waitlist_entries SET position = $1 WHERE id = $2', [
          i + 1,
          rows[i].id,
        ]);
      }

      await db.query('COMMIT');
      console.log(
        `[AutomaticOrderProcessor] Recalculated positions for ${rows.length} remaining waitlist entries`
      );
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('[AutomaticOrderProcessor] Failed to recalculate positions:', error);
    }
  }
}

module.exports = AutomaticOrderProcessor;
