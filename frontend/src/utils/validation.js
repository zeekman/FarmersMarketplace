// Shared form validation utilities
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;

// Kept in sync with backend/src/middleware/validate.js's WEAK_PASSWORDS set.
const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'Password1',
  'Password1!',
  '12345678',
  '123456789',
  'qwerty123',
  'iloveyou',
  'admin123',
  'letmein1',
  'welcome1',
  'monkey123',
]);

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
  if (WEAK_PASSWORDS.has(password)) issues.push('Not a commonly used password');
  return issues;
}

/** Returns true if the email looks valid (RFC 5321 compliant). */
export function isValidEmail(email) {
  // RFC 5321 compliant: allows subdomains, plus-addressing, dots in local part, etc.
  // Still rejects clearly invalid addresses (missing @, missing TLD, consecutive dots).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
         /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email.trim()) &&
         !/\.\./.test(email) &&
         !/\.@/.test(email) &&
         !/@\./.test(email);
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

// Product form rules. Mirrors the `product` schema in backend/src/middleware/validate.js — keep in sync.
// Input is the raw form state (strings); the backend's zod issues map back onto these field names.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRODUCT_CATEGORIES = ['vegetables', 'fruits', 'grains', 'dairy', 'herbs', 'other'];
const isSevenDp = (v) => Math.abs(v * 1e7 - Math.round(v * 1e7)) < 1e-6;

export const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200, 'Name must be 200 characters or fewer'),
    price: z.string().trim().min(1, 'Price is required').pipe(
      z.coerce.number({ error: 'Price must be a positive number' })
        .positive('Price must be a positive number')
        .max(1_000_000, 'Price seems too high (max 1,000,000 XLM)')
        .refine(isSevenDp, 'Price can have at most 7 decimal places')
    ),
    quantity: z.string().trim().min(1, 'Quantity is required').pipe(
      z.coerce.number({ error: 'Quantity must be a positive whole number' })
        .int('Quantity must be a positive whole number')
        .positive('Quantity must be a positive whole number')
        .max(1_000_000, 'Quantity seems too high (max 1,000,000)')
    ),
    category: z.enum(PRODUCT_CATEGORIES, { error: 'Pick a category' }),
    is_preorder: z.boolean(),
    preorder_delivery_date: z.string(),
    harvest_date: z.string().regex(DATE_RE, 'Date must be in YYYY-MM-DD format').or(z.literal('')),
    best_before: z.string().regex(DATE_RE, 'Date must be in YYYY-MM-DD format').or(z.literal('')),
  })
  .superRefine((d, ctx) => {
    // Local date; the backend compares against UTC, so a farmer near midnight may see a server-side rejection.
    const today = new Date().toLocaleDateString('en-CA');
    if (d.is_preorder && (!DATE_RE.test(d.preorder_delivery_date) || d.preorder_delivery_date < today)) {
      ctx.addIssue({ code: 'custom', path: ['preorder_delivery_date'], message: DATE_RE.test(d.preorder_delivery_date) ? 'Pre-order delivery date must be today or later' : 'Date must be in YYYY-MM-DD format' });
    }
    if (DATE_RE.test(d.harvest_date) && DATE_RE.test(d.best_before) && d.best_before < d.harvest_date) {
      ctx.addIssue({ code: 'custom', path: ['best_before'], message: 'Best before date must be on or after the harvest date' });
    }
  });

/**
 * Validates the product form against productSchema. Returns `{ fieldName: message }` (empty = valid).
 * Only the first message per field is kept.
 */
export function validateProductForm(form) {
  const result = productSchema.safeParse(form);
  const errors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  return errors;
}
