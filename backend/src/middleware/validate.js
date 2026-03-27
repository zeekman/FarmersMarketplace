const { z } = require('zod');
const { body, validationResult } = require('express-validator');

const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "Password1",
  "Password1!",
  "12345678",
  "123456789",
  "qwerty123",
  "iloveyou",
  "admin123",
  "letmein1",
  "welcome1",
  "monkey123",
]);

// Middleware factory — takes a Zod schema, validates req.body
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      const details = issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        message: details[0]?.message || "Validation error",
        code: "validation_error",
        details,
      });
    }
    req.body = result.data;
    next();
  };
}

// express-validator error handler middleware
function handle(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, code: 'validation_error' });
  }
  next();
}

const schemas = {
  register: validate(
    z.object({
      name: z.string().min(1, "name is required").trim(),
      email: z.string().email("valid email required"),
      password: z
        .string()
        .min(8, "password must be at least 8 characters")
        .regex(/[A-Z]/, "password must contain at least one uppercase letter")
        .regex(/[0-9]/, "password must contain at least one number")
        .refine(
          (v) => !WEAK_PASSWORDS.has(v),
          "password is too common, choose a stronger one",
        ),
      role: z
        .enum(["farmer", "buyer"])
        .refine((v) => ["farmer", "buyer"].includes(v), {
          message: "role must be farmer or buyer",
        }),
    }),
  ),

  login: validate(
    z.object({
      email: z.string().email("valid email required"),
      password: z.string().min(1, "password is required"),
    }),
  ),

  product: validate(
    z.object({
      name: z.string().min(1, "name is required").trim(),
      price: z.coerce.number().positive("price must be a positive number"),
      quantity: z.coerce
        .number()
        .int()
        .positive("quantity must be a positive integer"),
      unit: z.string().trim().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      low_stock_threshold: z.coerce.number().int().nonnegative().optional(),
      image_url: z.string().url().optional().or(z.literal("")),
    }),
  ),

  order: validate(
    z.object({
      product_id: z.coerce
        .number()
        .int()
        .positive("product_id must be a positive integer"),
      quantity: z.coerce
        .number()
        .int()
        .positive("quantity must be a positive integer"),
    }),
  ),

  order: validate(z.object({
    product_id: z.coerce.number().int().positive('product_id must be a positive integer'),
    quantity: z.coerce.number().int().positive('quantity must be a positive integer'),
    address_id: z.coerce.number().int().positive().optional(),
  })),

  updateOrderStatus: validate(
    z.object({
      status: z.enum(["processing", "shipped", "delivered"]),
    }),
  ),

  farmerProfile: validate(
    z.object({
      bio: z
        .string()
        .max(500, "bio must be 500 characters or fewer")
        .optional(),
      location: z
        .string()
        .max(100, "location must be 100 characters or fewer")
        .optional(),
      avatar_url: z
        .union([
          z
            .string()
            .regex(
              /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i,
              "avatar_url must be a valid upload path",
            ),
          z.literal(""),
          z.null(),
        ])
        .optional(),
    }),
  })),

  farmerProfile: validate(z.object({
    bio: z.string().max(500, 'bio must be 500 characters or fewer').optional(),
    location: z.string().max(100, 'location must be 100 characters or fewer').optional(),
    avatar_url: z.string().optional().nullable(),
  })),

  review: validate(z.object({
    order_id: z.coerce.number().int().positive('order_id must be a positive integer'),
    rating: z.coerce.number().int().min(1).max(5, 'rating must be an integer between 1 and 5'),
    comment: z.string().max(1000, 'comment must be 1000 characters or fewer').optional(),
  })),
  register: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('email').isEmail().withMessage('valid email required'),
    body('password')
      .isLength({ min: 8 }).withMessage('password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('password must contain at least one uppercase letter')
      .matches(/[0-9]/).withMessage('password must contain at least one number')
      .custom((value) => {
        if (WEAK_PASSWORDS.has(value)) {
          throw new Error('password is too common, choose a stronger one');
        }
        return true;
      }),
    body('role').isIn(['farmer', 'buyer']).withMessage('role must be farmer or buyer'),
    handle,
  ],
  login: [
    body('email').isEmail().withMessage('valid email required'),
    body('password').notEmpty().withMessage('password is required'),
    handle,
  ],
  product: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('price').isFloat({ gt: 0 }).withMessage('price must be a positive number'),
    body('quantity').isInt({ gt: 0 }).withMessage('quantity must be a positive integer'),
    body('unit').optional().trim().notEmpty().withMessage('unit cannot be blank'),
    handle,
  ],
  order: [
    body('product_id').isInt({ gt: 0 }).withMessage('product_id must be a positive integer'),
    body('quantity').isInt({ gt: 0 }).withMessage('quantity must be a positive integer'),
    handle,
  ],
  farmerProfile: [
    body('bio').optional().isString().isLength({ max: 500 }).withMessage('bio must be 500 characters or fewer').trim(),
    body('location').optional().isString().isLength({ max: 100 }).withMessage('location must be 100 characters or fewer').trim(),
    body('avatar_url').optional({ nullable: true }).custom(v => {
      if (v === null || v === '') return true;
      if (!/^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i.test(v))
        throw new Error('avatar_url must be a valid upload path');
      return true;
    }),
    handle,
  ],
  review: [
    body('order_id').isInt({ gt: 0 }).withMessage('order_id must be a positive integer'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be an integer between 1 and 5'),
    body('comment').optional().isString().isLength({ max: 1000 }).withMessage('comment must be 1000 characters or fewer').trim(),
    handle,
  ],
  sendXLM: [
    body('destination')
      .trim()
      .notEmpty().withMessage('destination is required')
      .matches(/^G[A-Z2-7]{55}$/).withMessage('destination must be a valid Stellar public key'),
    body('amount')
      .isFloat({ gt: 0 }).withMessage('amount must be a positive number')
      .custom(v => {
        if (parseFloat(v) < 0.0000001) throw new Error('amount too small');
        return true;
      }),
    body('memo')
      .optional()
      .isString()
      .isLength({ max: 28 }).withMessage('memo must be 28 characters or fewer')
      .trim(),
    handle,
  ],
};

module.exports = schemas;
