const router = require('express').Router();
const { err } = require('../middleware/error');

/**
 * @swagger
 * tags:
 *   name: Recommendations
 *   description: Product recommendations (not yet implemented)
 */

/**
 * @swagger
 * /api/recommendations:
 *   get:
 *     summary: Get product recommendations (not yet implemented)
 *     tags: [Recommendations]
 *     responses:
 *       501:
 *         description: Not Implemented
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 error: { type: string }
 *                 code: { type: string }
 */
router.get('/', (req, res) => {
  err(res, 501, 'Recommendations feature not yet implemented', 'not_implemented');
});

module.exports = router;
