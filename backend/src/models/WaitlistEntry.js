/**
 * WaitlistEntry Data Model
 *
 * Handles waitlist entry data validation, serialization, and database operations.
 * Validates: Requirements 7.1, 7.2, 7.3
 */

class WaitlistEntry {
  constructor(data = {}) {
    this.id = data.id !== undefined ? data.id : null;
    this.buyer_id = data.buyer_id !== undefined ? data.buyer_id : null;
    this.product_id = data.product_id !== undefined ? data.product_id : null;
    this.quantity = data.quantity !== undefined ? data.quantity : null;
    this.position = data.position !== undefined ? data.position : null;
    this.created_at = data.created_at !== undefined ? data.created_at : null;

    // Optional populated fields from joins
    this.buyer_name = data.buyer_name !== undefined ? data.buyer_name : null;
    this.buyer_email = data.buyer_email !== undefined ? data.buyer_email : null;
    this.product_name = data.product_name !== undefined ? data.product_name : null;
    this.product_price = data.product_price !== undefined ? data.product_price : null;
  }

  /**
   * Validates the waitlist entry data
   * @returns {Object} { isValid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Required field validation
    if (!this.buyer_id || !Number.isInteger(this.buyer_id) || this.buyer_id <= 0) {
      errors.push('buyer_id must be a positive integer');
    }

    if (!this.product_id || !Number.isInteger(this.product_id) || this.product_id <= 0) {
      errors.push('product_id must be a positive integer');
    }

    if (!this.quantity || !Number.isInteger(this.quantity) || this.quantity <= 0) {
      errors.push('quantity must be a positive integer');
    }

    // Position validation (if provided)
    if (this.position !== null && (!Number.isInteger(this.position) || this.position <= 0)) {
      errors.push('position must be a positive integer');
    }

    // Date validation (if provided)
    if (
      this.created_at !== null &&
      !(this.created_at instanceof Date) &&
      !this._isValidDateString(this.created_at)
    ) {
      errors.push('created_at must be a valid date');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates if a string is a valid date
   * @private
   */
  _isValidDateString(dateString) {
    if (typeof dateString !== 'string') return false;
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  }

  /**
   * Serializes the waitlist entry to JSON format
   * @returns {Object} JSON representation of the waitlist entry
   */
  toJSON() {
    const json = {
      id: this.id,
      buyer_id: this.buyer_id,
      product_id: this.product_id,
      quantity: this.quantity,
      position: this.position,
      created_at: this.created_at,
    };

    // Include populated fields if they exist
    if (this.buyer_name !== null) json.buyer_name = this.buyer_name;
    if (this.buyer_email !== null) json.buyer_email = this.buyer_email;
    if (this.product_name !== null) json.product_name = this.product_name;
    if (this.product_price !== null) json.product_price = this.product_price;

    return json;
  }

  /**
   * Creates a WaitlistEntry instance from JSON data
   * @param {Object|string} json - JSON object or string to parse
   * @returns {WaitlistEntry} New WaitlistEntry instance
   * @throws {Error} If JSON is invalid
   */
  static fromJSON(json) {
    let data;

    if (typeof json === 'string') {
      try {
        data = JSON.parse(json);
      } catch (error) {
        throw new Error(`Invalid JSON string: ${error.message}`);
      }
    } else if (typeof json === 'object' && json !== null) {
      data = json;
    } else {
      throw new Error('Input must be a JSON string or object');
    }

    return new WaitlistEntry(data);
  }

  /**
   * Formats the waitlist entry for API responses
   * @returns {Object} Formatted response object
   */
  format() {
    return this.toJSON();
  }

  /**
   * Creates a WaitlistEntry from database row data
   * @param {Object} row - Database row object
   * @returns {WaitlistEntry} New WaitlistEntry instance
   */
  static fromDatabaseRow(row) {
    if (!row) return null;

    return new WaitlistEntry({
      id: row.id,
      buyer_id: row.buyer_id,
      product_id: row.product_id,
      quantity: row.quantity,
      position: row.position,
      created_at: row.created_at,
      buyer_name: row.buyer_name,
      buyer_email: row.buyer_email,
      product_name: row.product_name,
      product_price: row.product_price,
    });
  }

  /**
   * Validates input for creating a new waitlist entry
   * @param {Object} input - Input data to validate
   * @returns {Object} { isValid: boolean, errors: string[], data: Object }
   */
  static validateCreateInput(input) {
    const errors = [];
    const data = {};

    // Validate buyer_id
    if (!input.buyer_id || !Number.isInteger(input.buyer_id) || input.buyer_id <= 0) {
      errors.push('buyer_id must be a positive integer');
    } else {
      data.buyer_id = input.buyer_id;
    }

    // Validate product_id
    if (!input.product_id || !Number.isInteger(input.product_id) || input.product_id <= 0) {
      errors.push('product_id must be a positive integer');
    } else {
      data.product_id = input.product_id;
    }

    // Validate quantity
    if (!input.quantity || !Number.isInteger(input.quantity) || input.quantity <= 0) {
      errors.push('quantity must be a positive integer');
    } else {
      data.quantity = input.quantity;
    }

    return {
      isValid: errors.length === 0,
      errors,
      data,
    };
  }

  /**
   * Checks if two WaitlistEntry instances are equal
   * @param {WaitlistEntry} other - Other WaitlistEntry to compare
   * @returns {boolean} True if entries are equal
   */
  equals(other) {
    if (!(other instanceof WaitlistEntry)) return false;

    return (
      this.id === other.id &&
      this.buyer_id === other.buyer_id &&
      this.product_id === other.product_id &&
      this.quantity === other.quantity &&
      this.position === other.position &&
      this.created_at === other.created_at
    );
  }

  /**
   * Creates a copy of the WaitlistEntry
   * @returns {WaitlistEntry} New WaitlistEntry instance with same data
   */
  clone() {
    return new WaitlistEntry(this.toJSON());
  }
}

module.exports = WaitlistEntry;
