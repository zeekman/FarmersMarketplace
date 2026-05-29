const router = require('express').Router();
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const WaitlistService = require('../services/WaitlistService');

/**
 * @swagger
 * tags:
 *   name: Waitlist
 *   description: Waitlist management endpoints
 */

/**
 * @swagger
 * /api/waitlist/mine:
 *   get:
 *     summary: Get buyer's active waitlist entries
 *     tags: [Waitlist]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of buyer's waitlist entries with product details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, description: Waitlist entry ID }
 *                       buyer_id: { type: integer, description: Buyer ID }
 *                       product_id: { type: integer, description: Product ID }
 *                       quantity: { type: integer, description: Desired quantity }
 *                       position: { type: integer, description: Position in waitlist }
 *                       created_at: { type: string, format: date-time, description: Entry creation time }
 *                       product_name: { type: string, description: Product name }
 *                       product_price: { type: number, description: Product price in XLM }
 *                       product_stock: { type: integer, description: Current product stock }
 *                 count: { type: integer, description: Total number of entries }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *                 code: { type: string }
 *       403:
 *         description: Only buyers can view waitlist entries
 *       404:
 *         description: Buyer not found
 */
// GET /api/waitlist/mine
router.get('/mine', auth, async (req, res) => {
  // Only buyers can view their waitlist entries
  if (req.user.role !== 'buyer') {
    return err(res, 403, 'Only buyers can view waitlist entries', 'forbidden');
  }

  try {
    const waitlistService = new WaitlistService();
    const result = await waitlistService.getBuyerWaitlistEntries(req.user.id);

    if (!result.success) {
      // Map service error codes to appropriate HTTP status codes
      let statusCode = 400;
      switch (result.code) {
        case 'BUYER_NOT_FOUND':
          statusCode = 404;
          break;
        case 'INVALID_INPUT':
          statusCode = 400;
          break;
        case 'INTERNAL_ERROR':
          statusCode = 500;
          break;
        default:
          statusCode = 400;
      }

      return err(res, statusCode, result.error, result.code);
    }

    // Success response
    res.json({
      success: true,
      data: result.data,
      count: result.count,
    });
  } catch (error) {
    console.error('[Waitlist] Error getting buyer waitlist entries:', error);
    return err(res, 500, 'Internal server error', 'internal_error');
  }
});

module.exports = router;
