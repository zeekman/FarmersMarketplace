const router = require('express').Router();
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');
const WaitlistService = require('../services/WaitlistService');

/**
 * @swagger
 * /api/products/{id}/waitlist/status:
 *   get:
 *     summary: Check waitlist status for product (buyer only)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Product ID to check waitlist status for
 *     responses:
 *       200:
 *         description: Waitlist status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 onWaitlist: { type: boolean, description: Whether buyer is on waitlist }
 *                 position: { type: integer, description: Position in waitlist (if on waitlist) }
 *                 totalWaiting: { type: integer, description: Total people waiting }
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
 *         description: Only buyers can check waitlist status
 *       404:
 *         description: Product not found
 */
// GET /api/products/:id/waitlist/status
router.get('/:id/waitlist/status', auth, async (req, res) => {
  // Only buyers can check waitlist status
  if (req.user.role !== 'buyer') {
    return err(res, 403, 'Only buyers can check waitlist status', 'forbidden');
  }

  const productId = parseInt(req.params.id, 10);

  // Validate product ID
  if (isNaN(productId) || productId <= 0) {
    return err(res, 400, 'Invalid product ID', 'validation_error');
  }

  try {
    const waitlistService = new WaitlistService();
    const result = await waitlistService.getWaitlistStatus(req.user.id, productId);

    if (!result.success) {
      // Map service error codes to appropriate HTTP status codes
      let statusCode = 400;
      switch (result.code) {
        case 'PRODUCT_NOT_FOUND':
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
    const response = {
      success: true,
      onWaitlist: result.onWaitlist,
      totalWaiting: result.totalWaiting,
    };

    // Only include position if buyer is on waitlist
    if (result.onWaitlist) {
      response.position = result.position;
    }

    res.json(response);
  } catch (error) {
    console.error('[Products] Error getting waitlist status:', error);
    return err(res, 500, 'Internal server error', 'internal_error');
  }
});

module.exports = router;
