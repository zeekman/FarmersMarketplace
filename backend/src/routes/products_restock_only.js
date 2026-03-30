const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const { sendBackInStockEmail } = require('../utils/mailer');
const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');

// PATCH /api/products/:id/restock
router.patch('/:id/restock', auth, async (req, res) => {
  if (req.user.role !== 'farmer')
    return err(res, 403, 'Only farmers can restock products', 'forbidden');

  const quantity = parseInt(req.body.quantity, 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    return err(res, 400, 'Quantity must be a positive integer', 'validation_error');
  }

  try {
    // Get product details
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    const product = rows[0];
    if (!product) return err(res, 404, 'Product not found or not yours', 'not_found');

    const wasOutOfStock = product.quantity === 0;

    // Update product stock atomically
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [
      quantity,
      req.params.id,
    ]);

    // Initialize response data
    let waitlistResults = null;

    // Process waitlist if product was out of stock (automatic order processing)
    if (wasOutOfStock) {
      const processor = new AutomaticOrderProcessor();
      waitlistResults = await processor.processWaitlistOnRestock(parseInt(req.params.id), quantity);

      if (!waitlistResults.success) {
        console.error('[Restock] Waitlist processing failed:', waitlistResults.error);
        // Don't fail the restock operation, just log the error
      }
    }

    // Handle existing stock alert notifications (backward compatibility)
    if (wasOutOfStock) {
      const { rows: subscribers } = await db.query(
        `SELECT u.email, u.name FROM stock_alerts sa JOIN users u ON sa.user_id = u.id WHERE sa.product_id = $1`,
        [req.params.id]
      );

      if (subscribers.length > 0) {
        await db.query('DELETE FROM stock_alerts WHERE product_id = $1', [req.params.id]);
        Promise.all(
          subscribers.map((s) =>
            sendBackInStockEmail({ email: s.email, name: s.name, productName: product.name })
          )
        ).catch((e) => console.error('[stock-alert] Email send failed:', e.message));
      }
    }

    // Prepare response with waitlist processing results
    const response = {
      success: true,
      message: 'Restocked successfully',
    };

    // Include waitlist processing results if available
    if (waitlistResults) {
      response.waitlist = {
        processed: waitlistResults.processed || 0,
        skipped: waitlistResults.skipped || 0,
        totalEntries: waitlistResults.totalEntries || 0,
        remainingStock: waitlistResults.remainingStock || quantity,
        errors: waitlistResults.errors || [],
      };
    }

    res.json(response);
  } catch (error) {
    console.error('[Restock] Error processing restock:', error);
    return err(res, 500, 'Internal server error during restock', 'internal_error');
  }
});

module.exports = router;
