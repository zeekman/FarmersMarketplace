// Shared form validation utilities

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Returns an array of password strength issues (empty = strong enough).
 */
export function validatePassword(password) {
  const issues = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    issues.push(`At least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) issues.push('One uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('One lowercase letter');
  if (!/\d/.test(password)) issues.push('One number');
  return issues;
}

/** Returns true if the email looks valid. */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validates the login form. Returns an errors object (empty = valid).
 */
export function validateLogin({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Email is required';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  return errors;
}

/**
 * Validates the registration form. Returns an errors object (empty = valid).
 */
export function validateRegister({ name, email, password }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Name is required';
  else if (name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
  else if (name.trim().length > 100) errors.name = 'Name must be 100 characters or fewer';

  if (!email.trim()) errors.email = 'Email is required';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address';

  if (!password) errors.password = 'Password is required';
  else {
    const issues = validatePassword(password);
    if (issues.length > 0) errors.password = `Password needs: ${issues.join(', ')}`;
  }
  return errors;
}

/**
 * Validates the product creation form. Returns an errors object (empty = valid).
 */
export function validateProduct({ name, price, quantity, nutrition }) {
  const errors = {};
  if (!name || !name.trim()) errors.name = 'Product name is required';
  else if (name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
  else if (name.trim().length > 200) errors.name = 'Name must be 200 characters or fewer';

  const priceNum = parseFloat(price);
  if (price === '' || price === null || price === undefined) errors.price = 'Price is required';
  else if (isNaN(priceNum) || priceNum <= 0) errors.price = 'Price must be a positive number';
  else if (priceNum > 1_000_000) errors.price = 'Price seems too high (max 1,000,000 XLM)';
  else if (!/^\d+(\.\d{1,7})?$/.test(String(price).trim())) errors.price = 'Price can have at most 7 decimal places';

  const qtyNum = parseInt(quantity, 10);
  if (quantity === '' || quantity === null || quantity === undefined) errors.quantity = 'Quantity is required';
  else if (isNaN(qtyNum) || qtyNum <= 0) errors.quantity = 'Quantity must be a positive whole number';
  else if (qtyNum > 1_000_000) errors.quantity = 'Quantity seems too high (max 1,000,000)';

  // Validate nutrition if provided
  if (nutrition) {
    const nutritionErrors = {};
    const fields = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
    fields.forEach(field => {
      if (nutrition[field] !== undefined && nutrition[field] !== '') {
        const val = parseFloat(nutrition[field]);
        if (isNaN(val) || val < 0) {
          nutritionErrors[field] = `${field.charAt(0).toUpperCase() + field.slice(1)} must be a non-negative number`;
        }
      }
    });
    if (Object.keys(nutritionErrors).length > 0) {
      errors.nutrition = nutritionErrors;
    }
  }

  return errors;
}
