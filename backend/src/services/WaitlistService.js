/**
 * WaitlistService - Core service for managing product waitlists
 *
 * Handles waitlist entry creation, removal, position management, and FIFO ordering.
 * Integrates with the existing database layer and follows established patterns.
 *
 * Validates: Requirements 1.1, 1.4, 1.5
 */

const db = require('../db/schema');
const WaitlistEntry = require('../models/WaitlistEntry');

class WaitlistService {
  /**
   * Join a waitlist for an out-of-stock product
   * @param {number} buyerId - The buyer's user ID
   * @param {number} productId - The product ID to join waitlist for
   * @param {number} quantity - Desired quantity
   * @returns {Promise<{success: boolean, position: number, totalWaiting: number, entry?: WaitlistEntry}>}
   */
  async joinWaitlist(buyerId, productId, quantity) {
    // Enhanced input validation
    const inputValidation = this._validateJoinWaitlistInput(buyerId, productId, quantity);
    if (!inputValidation.isValid) {
      return { success: false, error: inputValidation.error, code: 'INVALID_INPUT' };
    }

    try {
      // Check if buyer exists and has correct role
      const buyerValidation = await this._validateBuyer(buyerId);
      if (!buyerValidation.isValid) {
        return { success: false, error: buyerValidation.error, code: buyerValidation.code };
      }

      // Check if product exists and get details
      const productValidation = await this._validateProduct(productId);
      if (!productValidation.isValid) {
        return { success: false, error: productValidation.error, code: productValidation.code };
      }

      const product = productValidation.product;

      // Check if product is in stock (Requirement 1.3)
      if (product.quantity > 0) {
        return {
          success: false,
          error: `Product "${product.name}" is currently available for purchase with ${product.quantity} units in stock`,
          code: 'PRODUCT_IN_STOCK',
        };
      }

      // Check if buyer already on waitlist for this product (Requirement 1.2)
      const duplicateCheck = await this._checkDuplicateEntry(buyerId, productId);
      if (!duplicateCheck.isValid) {
        return { success: false, error: duplicateCheck.error, code: 'DUPLICATE_ENTRY' };
      }

      // Validate quantity against business rules
      const quantityValidation = await this._validateQuantityLimits(productId, quantity, buyerId);
      if (!quantityValidation.isValid) {
        return { success: false, error: quantityValidation.error, code: 'INVALID_QUANTITY' };
      }

      // Get next position (FIFO ordering based on created_at)
      const { rows: positionRows } = await db.query(
        'SELECT COALESCE(MAX(position), 0) + 1 as next_position FROM waitlist_entries WHERE product_id = $1',
        [productId]
      );
      const position = positionRows[0].next_position;

      // Create waitlist entry
      const { rows: insertRows } = await db.query(
        `INSERT INTO waitlist_entries (buyer_id, product_id, quantity, position, created_at) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
         RETURNING id, buyer_id, product_id, quantity, position, created_at`,
        [buyerId, productId, quantity, position]
      );

      const entry = WaitlistEntry.fromDatabaseRow(insertRows[0]);

      // Get total waiting count
      const { rows: countRows } = await db.query(
        'SELECT COUNT(*) as total FROM waitlist_entries WHERE product_id = $1',
        [productId]
      );
      const totalWaiting = parseInt(countRows[0].total);

      return {
        success: true,
        position,
        totalWaiting,
        entry,
      };
    } catch (error) {
      console.error('[WaitlistService] Error joining waitlist:', error);
      return { success: false, error: 'Failed to join waitlist', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Enhanced input validation for joinWaitlist
   * @private
   */
  _validateJoinWaitlistInput(buyerId, productId, quantity) {
    const errors = [];

    // Validate buyerId
    if (buyerId === null || buyerId === undefined) {
      errors.push('buyer_id is required');
    } else if (!Number.isInteger(buyerId) || buyerId <= 0) {
      errors.push('buyer_id must be a positive integer');
    } else if (buyerId > Number.MAX_SAFE_INTEGER) {
      errors.push('buyer_id exceeds maximum allowed value');
    }

    // Validate productId
    if (productId === null || productId === undefined) {
      errors.push('product_id is required');
    } else if (!Number.isInteger(productId) || productId <= 0) {
      errors.push('product_id must be a positive integer');
    } else if (productId > Number.MAX_SAFE_INTEGER) {
      errors.push('product_id exceeds maximum allowed value');
    }

    // Validate quantity
    if (quantity === null || quantity === undefined) {
      errors.push('quantity is required');
    } else if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push('quantity must be a positive integer');
    } else if (quantity > 1000) {
      errors.push('quantity cannot exceed 1000 units per waitlist entry');
    }

    return {
      isValid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
    };
  }

  /**
   * Validate buyer exists and has correct permissions
   * @private
   */
  async _validateBuyer(buyerId) {
    try {
      const { rows } = await db.query('SELECT id, role, is_active FROM users WHERE id = $1', [
        buyerId,
      ]);

      if (!rows[0]) {
        return { isValid: false, error: 'Buyer not found', code: 'BUYER_NOT_FOUND' };
      }

      const user = rows[0];

      if (!user.is_active) {
        return { isValid: false, error: 'Account is inactive', code: 'ACCOUNT_INACTIVE' };
      }

      if (user.role !== 'buyer') {
        return { isValid: false, error: 'Only buyers can join waitlists', code: 'INVALID_ROLE' };
      }

      return { isValid: true, user };
    } catch (error) {
      console.error('[WaitlistService] Error validating buyer:', error);
      return { isValid: false, error: 'Failed to validate buyer', code: 'VALIDATION_ERROR' };
    }
  }

  /**
   * Validate product exists and get product details
   * @private
   */
  async _validateProduct(productId) {
    try {
      const { rows } = await db.query(
        'SELECT id, name, quantity, is_active, max_quantity_per_order FROM products WHERE id = $1',
        [productId]
      );

      if (!rows[0]) {
        return { isValid: false, error: 'Product not found', code: 'PRODUCT_NOT_FOUND' };
      }

      const product = rows[0];

      if (!product.is_active) {
        return {
          isValid: false,
          error: 'Product is no longer available',
          code: 'PRODUCT_INACTIVE',
        };
      }

      return { isValid: true, product };
    } catch (error) {
      console.error('[WaitlistService] Error validating product:', error);
      return { isValid: false, error: 'Failed to validate product', code: 'VALIDATION_ERROR' };
    }
  }

  /**
   * Check for duplicate waitlist entries (Requirement 1.2)
   * @private
   */
  async _checkDuplicateEntry(buyerId, productId) {
    try {
      const { rows } = await db.query(
        'SELECT id, position, created_at FROM waitlist_entries WHERE buyer_id = $1 AND product_id = $2',
        [buyerId, productId]
      );

      if (rows[0]) {
        const entry = rows[0];
        return {
          isValid: false,
          error: `Already on waitlist for this product at position ${entry.position} (joined ${new Date(entry.created_at).toLocaleDateString()})`,
          existingEntry: entry,
        };
      }

      return { isValid: true };
    } catch (error) {
      console.error('[WaitlistService] Error checking duplicate entry:', error);
      return {
        isValid: false,
        error: 'Failed to check existing waitlist entries',
        code: 'VALIDATION_ERROR',
      };
    }
  }

  /**
   * Validate quantity against business rules and limits
   * @private
   */
  async _validateQuantityLimits(productId, quantity, buyerId) {
    try {
      // Get product-specific quantity limits
      const { rows: productRows } = await db.query(
        'SELECT max_quantity_per_order FROM products WHERE id = $1',
        [productId]
      );

      const product = productRows[0];
      if (product && product.max_quantity_per_order && quantity > product.max_quantity_per_order) {
        return {
          isValid: false,
          error: `Quantity ${quantity} exceeds maximum allowed per order (${product.max_quantity_per_order})`,
        };
      }

      // Check total waitlist quantity for this buyer across all products (optional business rule)
      const { rows: totalRows } = await db.query(
        'SELECT COALESCE(SUM(quantity), 0) as total_quantity FROM waitlist_entries WHERE buyer_id = $1',
        [buyerId]
      );

      const totalWaitlistQuantity = parseInt(totalRows[0].total_quantity);
      const maxTotalWaitlistQuantity = 100; // Business rule: max 100 items across all waitlists

      if (totalWaitlistQuantity + quantity > maxTotalWaitlistQuantity) {
        return {
          isValid: false,
          error: `Adding ${quantity} items would exceed your total waitlist limit of ${maxTotalWaitlistQuantity} items (currently have ${totalWaitlistQuantity})`,
        };
      }

      return { isValid: true };
    } catch (error) {
      console.error('[WaitlistService] Error validating quantity limits:', error);
      return { isValid: false, error: 'Failed to validate quantity limits' };
    }
  }

  /**
   * Leave a waitlist for a product
   * @param {number} buyerId - The buyer's user ID
   * @param {number} productId - The product ID to leave waitlist for
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  async leaveWaitlist(buyerId, productId) {
    // Enhanced input validation
    const inputValidation = this._validateLeaveWaitlistInput(buyerId, productId);
    if (!inputValidation.isValid) {
      return { success: false, error: inputValidation.error, code: 'INVALID_INPUT' };
    }

    try {
      // Validate buyer permissions
      const buyerValidation = await this._validateBuyer(buyerId);
      if (!buyerValidation.isValid) {
        return { success: false, error: buyerValidation.error, code: buyerValidation.code };
      }

      // Check if entry exists and belongs to the buyer
      const { rows: entryRows } = await db.query(
        'SELECT id, position FROM waitlist_entries WHERE buyer_id = $1 AND product_id = $2',
        [buyerId, productId]
      );
      if (!entryRows[0]) {
        return {
          success: false,
          error: 'Not on waitlist for this product',
          code: 'ENTRY_NOT_FOUND',
        };
      }

      const removedPosition = entryRows[0].position;

      // Use transaction for atomic operation
      await db.query('BEGIN');

      try {
        // Remove the entry
        await db.query('DELETE FROM waitlist_entries WHERE buyer_id = $1 AND product_id = $2', [
          buyerId,
          productId,
        ]);

        // Update positions for remaining entries (decrement positions after the removed one)
        const { rows: updatedRows } = await db.query(
          'UPDATE waitlist_entries SET position = position - 1 WHERE product_id = $1 AND position > $2 RETURNING id',
          [productId, removedPosition]
        );

        await db.query('COMMIT');

        return {
          success: true,
          message: `Successfully left waitlist (${updatedRows.length} positions updated)`,
          code: 'SUCCESS',
        };
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('[WaitlistService] Error leaving waitlist:', error);
      return { success: false, error: 'Failed to leave waitlist', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Enhanced input validation for leaveWaitlist
   * @private
   */
  _validateLeaveWaitlistInput(buyerId, productId) {
    const errors = [];

    // Validate buyerId
    if (buyerId === null || buyerId === undefined) {
      errors.push('buyer_id is required');
    } else if (!Number.isInteger(buyerId) || buyerId <= 0) {
      errors.push('buyer_id must be a positive integer');
    }

    // Validate productId
    if (productId === null || productId === undefined) {
      errors.push('product_id is required');
    } else if (!Number.isInteger(productId) || productId <= 0) {
      errors.push('product_id must be a positive integer');
    }

    return {
      isValid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
    };
  }

  /**
   * Get waitlist status for a buyer and product
   * @param {number} buyerId - The buyer's user ID
   * @param {number} productId - The product ID to check status for
   * @returns {Promise<{success: boolean, onWaitlist: boolean, position?: number, totalWaiting: number}>}
   */
  async getWaitlistStatus(buyerId, productId) {
    // Enhanced input validation
    const inputValidation = this._validateStatusInput(buyerId, productId);
    if (!inputValidation.isValid) {
      return { success: false, error: inputValidation.error, code: 'INVALID_INPUT' };
    }

    try {
      // Validate product exists
      const productValidation = await this._validateProduct(productId);
      if (!productValidation.isValid) {
        return { success: false, error: productValidation.error, code: productValidation.code };
      }

      // Check if buyer is on waitlist
      const { rows: entryRows } = await db.query(
        'SELECT position FROM waitlist_entries WHERE buyer_id = $1 AND product_id = $2',
        [buyerId, productId]
      );

      // Get total waiting count
      const { rows: countRows } = await db.query(
        'SELECT COUNT(*) as total FROM waitlist_entries WHERE product_id = $1',
        [productId]
      );
      const totalWaiting = parseInt(countRows[0].total);

      if (entryRows[0]) {
        return {
          success: true,
          onWaitlist: true,
          position: entryRows[0].position,
          totalWaiting,
          code: 'ON_WAITLIST',
        };
      } else {
        return {
          success: true,
          onWaitlist: false,
          totalWaiting,
          code: 'NOT_ON_WAITLIST',
        };
      }
    } catch (error) {
      console.error('[WaitlistService] Error getting waitlist status:', error);
      return { success: false, error: 'Failed to get waitlist status', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Enhanced input validation for status methods
   * @private
   */
  _validateStatusInput(buyerId, productId) {
    const errors = [];

    // Validate buyerId
    if (buyerId === null || buyerId === undefined) {
      errors.push('buyer_id is required');
    } else if (!Number.isInteger(buyerId) || buyerId <= 0) {
      errors.push('buyer_id must be a positive integer');
    }

    // Validate productId
    if (productId === null || productId === undefined) {
      errors.push('product_id is required');
    } else if (!Number.isInteger(productId) || productId <= 0) {
      errors.push('product_id must be a positive integer');
    }

    return {
      isValid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
    };
  }

  /**
   * Get all waitlist entries for a buyer
   * @param {number} buyerId - The buyer's user ID
   * @returns {Promise<{success: boolean, data?: WaitlistEntry[], error?: string}>}
   */
  async getBuyerWaitlistEntries(buyerId) {
    // Enhanced input validation
    if (!buyerId || !Number.isInteger(buyerId) || buyerId <= 0) {
      return {
        success: false,
        error: 'buyer_id must be a positive integer',
        code: 'INVALID_INPUT',
      };
    }

    try {
      // Validate buyer exists
      const buyerValidation = await this._validateBuyer(buyerId);
      if (!buyerValidation.isValid) {
        return { success: false, error: buyerValidation.error, code: buyerValidation.code };
      }

      const { rows } = await db.query(
        `SELECT we.*, p.name as product_name, p.price as product_price, p.quantity as product_stock
         FROM waitlist_entries we
         JOIN products p ON we.product_id = p.id
         WHERE we.buyer_id = $1 AND p.is_active = true
         ORDER BY we.created_at ASC`,
        [buyerId]
      );

      const entries = rows.map((row) => WaitlistEntry.fromDatabaseRow(row));

      return {
        success: true,
        data: entries,
        count: entries.length,
        code: 'SUCCESS',
      };
    } catch (error) {
      console.error('[WaitlistService] Error getting buyer waitlist entries:', error);
      return { success: false, error: 'Failed to get waitlist entries', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Get waitlist entries for a product in FIFO order
   * @param {number} productId - The product ID
   * @param {number} limit - Maximum number of entries to return (optional)
   * @returns {Promise<{success: boolean, data?: WaitlistEntry[], error?: string}>}
   */
  async getProductWaitlistEntries(productId, limit = null) {
    // Enhanced input validation
    if (!productId || !Number.isInteger(productId) || productId <= 0) {
      return {
        success: false,
        error: 'product_id must be a positive integer',
        code: 'INVALID_INPUT',
      };
    }

    if (limit !== null && (!Number.isInteger(limit) || limit <= 0 || limit > 1000)) {
      return {
        success: false,
        error: 'limit must be a positive integer between 1 and 1000',
        code: 'INVALID_INPUT',
      };
    }

    try {
      // Validate product exists
      const productValidation = await this._validateProduct(productId);
      if (!productValidation.isValid) {
        return { success: false, error: productValidation.error, code: productValidation.code };
      }

      let query = `
        SELECT we.*, u.name as buyer_name, u.email as buyer_email
        FROM waitlist_entries we
        JOIN users u ON we.buyer_id = u.id
        WHERE we.product_id = $1 AND u.is_active = true
        ORDER BY we.position ASC
      `;

      const params = [productId];
      if (limit) {
        query += ` LIMIT $2`;
        params.push(limit);
      }

      const { rows } = await db.query(query, params);
      const entries = rows.map((row) => WaitlistEntry.fromDatabaseRow(row));

      return {
        success: true,
        data: entries,
        count: entries.length,
        code: 'SUCCESS',
      };
    } catch (error) {
      console.error('[WaitlistService] Error getting product waitlist entries:', error);
      return { success: false, error: 'Failed to get waitlist entries', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Get total waitlist count for a product
   * @param {number} productId - The product ID
   * @returns {Promise<{success: boolean, count?: number, error?: string}>}
   */
  async getWaitlistCount(productId) {
    // Enhanced input validation
    if (!productId || !Number.isInteger(productId) || productId <= 0) {
      return {
        success: false,
        error: 'product_id must be a positive integer',
        code: 'INVALID_INPUT',
      };
    }

    try {
      // Validate product exists
      const productValidation = await this._validateProduct(productId);
      if (!productValidation.isValid) {
        return { success: false, error: productValidation.error, code: productValidation.code };
      }

      const { rows } = await db.query(
        `SELECT COUNT(*) as count 
         FROM waitlist_entries we
         JOIN users u ON we.buyer_id = u.id
         WHERE we.product_id = $1 AND u.is_active = true`,
        [productId]
      );

      return {
        success: true,
        count: parseInt(rows[0].count),
        code: 'SUCCESS',
      };
    } catch (error) {
      console.error('[WaitlistService] Error getting waitlist count:', error);
      return { success: false, error: 'Failed to get waitlist count', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Recalculate positions for all entries in a product's waitlist
   * This ensures position integrity after any manual database operations
   * @param {number} productId - The product ID
   * @returns {Promise<{success: boolean, updated?: number, error?: string}>}
   */
  async recalculatePositions(productId) {
    // Enhanced input validation
    if (!productId || !Number.isInteger(productId) || productId <= 0) {
      return {
        success: false,
        error: 'product_id must be a positive integer',
        code: 'INVALID_INPUT',
      };
    }

    try {
      // Validate product exists
      const productValidation = await this._validateProduct(productId);
      if (!productValidation.isValid) {
        return { success: false, error: productValidation.error, code: productValidation.code };
      }

      // Use transaction for atomic operation
      await db.query('BEGIN');

      try {
        // Get all entries ordered by created_at (FIFO)
        const { rows } = await db.query(
          `SELECT we.id 
           FROM waitlist_entries we
           JOIN users u ON we.buyer_id = u.id
           WHERE we.product_id = $1 AND u.is_active = true
           ORDER BY we.created_at ASC`,
          [productId]
        );

        // Update positions sequentially
        let updated = 0;
        for (let i = 0; i < rows.length; i++) {
          await db.query('UPDATE waitlist_entries SET position = $1 WHERE id = $2', [
            i + 1,
            rows[i].id,
          ]);
          updated++;
        }

        await db.query('COMMIT');

        return {
          success: true,
          updated,
          code: 'SUCCESS',
        };
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('[WaitlistService] Error recalculating positions:', error);
      return { success: false, error: 'Failed to recalculate positions', code: 'INTERNAL_ERROR' };
    }
  }
}

module.exports = WaitlistService;
