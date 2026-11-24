const { z } = require('zod');

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

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues || [];
      const details = issues.map((e) => ({ field: e.path.join('.'), message: e.message }));
      return res.status(400).json({
        success: false,
        message: details[0]?.message || 'Validation error',
        code: 'validation_error',
        details,
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  register: validate(
    z.object({
      name: z.string().min(1, 'name is required').trim(),
      email: z.string().email('valid email required'),
      password: z
        .string()
        .min(8, 'password must be at least 8 characters')
        .regex(/[A-Z]/, 'password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'password must contain at least one number')
        .refine((v) => !WEAK_PASSWORDS.has(v), 'password is too common, choose a stronger one'),
      role: z.enum(['farmer', 'buyer']),
      ref: z.string().optional(),
    })
  ),

  login: validate(
    z.object({
      email: z.string().email('valid email required'),
      password: z.string().min(1, 'password is required'),
    })
  ),

  changePassword: validate(
    z.object({
      current_password: z.string().min(1, 'current_password is required'),
      new_password: z
        .string()
        .min(8, 'new_password must be at least 8 characters')
        .regex(/[A-Z]/, 'new_password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'new_password must contain at least one number')
        .refine((v) => !WEAK_PASSWORDS.has(v), 'new_password is too common, choose a stronger one'),
    })
  ),

  product: validate(
    z
      .object({
        // Mirrored in frontend/src/utils/validation.js (productSchema) — keep in sync.
        name: z.string().trim().min(2, 'name must be at least 2 characters').max(200, 'name must be 200 characters or fewer'),
        price: z.coerce
          .number()
          .positive('price must be a positive number')
          .max(1_000_000, 'price seems too high (max 1,000,000 XLM)')
          .refine((v) => Math.abs(v * 1e7 - Math.round(v * 1e7)) < 1e-6, 'price can have at most 7 decimal places'),
        quantity: z.coerce
          .number()
          .int('quantity must be a positive integer')
          .positive('quantity must be a positive integer')
          .max(1_000_000, 'quantity seems too high (max 1,000,000)'),
        unit: z.string().trim().optional(),
        description: z.string().optional(),
        category: z.enum(['vegetables', 'fruits', 'grains', 'dairy', 'herbs', 'other']).optional(),
        harvest_date: z.string().nullable().optional(),
        best_before: z.string().nullable().optional(),
        low_stock_threshold: z.coerce.number().int().nonnegative().optional(),
        image_url: z.string().optional().or(z.literal('')),
        tags: z.array(z.string()).optional(),
        nutrition: z
          .object({
            calories: z.coerce.number().nonnegative('calories must be non-negative').optional(),
            protein: z.coerce.number().nonnegative('protein must be non-negative').optional(),
            carbs: z.coerce.number().nonnegative('carbs must be non-negative').optional(),
            fat: z.coerce.number().nonnegative('fat must be non-negative').optional(),
            fiber: z.coerce.number().nonnegative('fiber must be non-negative').optional(),
            vitamins: z
              .record(z.coerce.number().nonnegative('vitamin values must be non-negative'))
              .optional(),
          })
          .optional(),
        pricing_type: z.enum(['unit', 'weight']).optional(),
        min_weight: z.coerce.number().positive('min_weight must be positive').optional(),
        max_weight: z.coerce.number().positive('max_weight must be positive').optional(),
        min_order_quantity: z.coerce
          .number()
          .int()
          .positive('min_order_quantity must be a positive integer')
          .optional(),
        pricing_model: z.enum(['fixed', 'pwyw', 'donation']).default('fixed'),
        min_price: z.coerce.number().nonnegative('min_price must be non-negative').optional(),
        weight_kg: z.coerce.number().positive('weight_kg must be a positive number').optional(),
        is_preorder: z
          .union([z.boolean(), z.literal(0), z.literal(1), z.enum(['0', '1'])])
          .optional(),
        preorder_delivery_date: z.string().nullable().optional(),
        allergens: z.array(z.string()).optional(),
        allowed_regions: z.array(z.string()).optional(),
        available_from: z.string().nullable().optional(),
        available_until: z.string().nullable().optional(),
      })
      .refine(
        (d) => {
          if (d.pricing_type === 'weight') {
            if (!d.min_weight || !d.max_weight) return false;
            if (d.min_weight >= d.max_weight) return false;
          }
          if (d.pricing_model === 'pwyw' && d.min_price === undefined) return false;
          return true;
        },
        {
          message:
            'Incomplete pricing configuration: weight-based requires min<max, and PWYW requires min_price',
        }
      )
      // YYYY-MM-DD strings compare correctly as text. Dates are checked in UTC.
      .superRefine((d, ctx) => {
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        const isPreorder = d.is_preorder === true || d.is_preorder === 1 || d.is_preorder === '1';
        const today = new Date().toISOString().slice(0, 10);
        if (isPreorder && DATE_RE.test(d.preorder_delivery_date || '') && d.preorder_delivery_date < today) {
          ctx.addIssue({ code: 'custom', path: ['preorder_delivery_date'], message: 'pre-order delivery date must be today or later' });
        }
        if (DATE_RE.test(d.harvest_date || '') && DATE_RE.test(d.best_before || '') && d.best_before < d.harvest_date) {
          ctx.addIssue({ code: 'custom', path: ['best_before'], message: 'best before date must be on or after the harvest date' });
        }
      })
  ),

  order: validate(
    z
      .object({
        product_id: z.coerce
          .number()
          .int()
          .positive('product_id must be a positive integer')
          .optional(),
        quantity: z.coerce
          .number()
          .int()
          .positive('quantity must be a positive integer')
          .max(
            parseInt(process.env.MAX_ORDER_QUANTITY, 10) || 10000,
            `quantity cannot exceed ${parseInt(process.env.MAX_ORDER_QUANTITY, 10) || 10000}`
          )
          .optional(),
        address_id: z.coerce.number().int().positive().optional(),
        use_soroban_escrow: z.coerce.boolean().optional(),
        payment_method: z.enum(['sep7']).optional(),
        weight: z.coerce.number().positive('weight must be a positive number').optional(),
        custom_price: z.coerce
          .number()
          .positive('custom_price must be a positive number')
          .optional(),
        coupon_code: z.string().optional(),
        source_asset: z
          .object({
            code: z.string(),
            issuer: z.string().optional(),
          })
          .optional(),
        source_asset_code: z.string().optional(),
        source_asset_issuer: z.string().optional(),
        max_source_amount: z.coerce
          .number()
          .positive('max_source_amount must be a positive number')
          .optional(),
        bundle_id: z.coerce
          .number()
          .int()
          .positive('bundle_id must be a positive integer')
          .optional(),
      })
      .refine(
        (data) => {
          // Either product_id (single product) or bundle_id (bundle) must be provided
          if (!data.product_id && !data.bundle_id) {
            return false;
          }
          if (data.product_id && data.bundle_id) {
            return false;
          }
          // If bundle_id is provided, quantity should not be used (bundle has its own quantities)
          if (data.bundle_id && data.quantity) {
            return false;
          }
          return true;
        },
        { message: 'Either product_id (with quantity) or bundle_id must be provided, but not both' }
      )
      .optional(),
    address_id: z.coerce.number().int().positive().optional(),
    use_soroban_escrow: z.coerce.boolean().optional(),
    payment_method: z.enum(['sep7']).optional(),
    weight: z.coerce.number().positive('weight must be a positive number').optional(),
    custom_price: z.coerce.number().positive('custom_price must be a positive number').optional(),
    coupon_code: z.string().optional(),
    source_asset: z.object({
      code: z.string(),
      issuer: z.string().optional(),
    }).optional(),
    source_asset_code: z.string().optional(),
    source_asset_issuer: z.string().optional(),
    max_source_amount: z.coerce.number().positive('max_source_amount must be a positive number').optional(),
    bundle_id: z.coerce.number().int().positive('bundle_id must be a positive integer').optional(),
    reward_tokens: z.coerce.number().int().nonnegative('reward_tokens must be a non-negative integer').optional(),
  }).refine(data => {
    // Either product_id (single product) or bundle_id (bundle) must be provided
    if (!data.product_id && !data.bundle_id) {
      return false;
    }
    if (data.product_id && data.bundle_id) {
      return false;
    }
    // If bundle_id is provided, quantity should not be used (bundle has its own quantities)
    if (data.bundle_id && data.quantity) {
      return false;
    }
    return true;
  }, { message: 'Either product_id (with quantity) or bundle_id must be provided, but not both' })),
  ),
  updateOrderStatus: validate(
    z.object({
      status: z.enum(['processing', 'shipped', 'delivered']),
    })
  ),

  farmerProfile: validate(
    z.object({
      bio: z.string().max(500, 'bio must be 500 characters or fewer').optional(),
      location: z.string().max(100, 'location must be 100 characters or fewer').optional(),
      avatar_url: z
        .union([
          z
            .string()
            .regex(
              /^\/uploads\/[a-f0-9]+\.(jpg|jpeg|png|webp)$/i,
              'avatar_url must be a valid upload path'
            ),
          z.literal(''),
          z.null(),
        ])
        .optional(),
      federation_name: z.string().optional().nullable(),
    })
  ),

  review: validate(
    z.object({
      order_id: z.coerce.number().int().positive('order_id must be a positive integer'),
      rating: z.coerce.number().int().min(1).max(5, 'rating must be an integer between 1 and 5'),
      comment: z.string().max(1000, 'comment must be 1000 characters or fewer').optional(),
    })
  ),

  sendXLM: validate(
    z.object({
      destination: z
        .string()
        .regex(/^G[A-Z2-7]{55}$/, 'destination must be a valid Stellar public key'),
      amount: z.coerce
        .number()
        .positive('amount must be a positive number')
        .refine((v) => v >= 0.0000001, 'amount too small'),
      memo: z.string().max(28, 'memo must be 28 characters or fewer').optional(),
    })
  ),

  waitlist: validate(
    z.object({
      quantity: z.coerce
        .number()
        .int()
        .positive('quantity must be a positive integer')
        .max(1000, 'quantity cannot exceed 1000 units'),
    })
  ),

  cropAlert: validate(
    z.object({
      alert_type: z.enum(['pest', 'disease', 'weather', 'other']),
      description: z
        .string()
        .min(10, 'description must be at least 10 characters')
        .max(1000, 'description must be 1000 characters or fewer'),
      location: z.string().max(200, 'location must be 200 characters or fewer').optional(),
      latitude: z.coerce.number().min(-90).max(90).optional(),
      longitude: z.coerce.number().min(-180).max(180).optional(),
      severity: z.enum(['low', 'medium', 'high']).optional(),
    })
  ),

  confirmPassword: validate(
    z.object({
      password: z.string().min(1, 'password is required'),
      totp: z.string().regex(/^\d{6}$/, 'totp must be a 6-digit code').optional(),
    })
  ),

  recover: validate(
    z.object({
      email: z.string().email('valid email required'),
      password: z.string().min(1, 'password is required'),
      mnemonic: z.string().min(1, 'mnemonic is required'),
    })
  ),

  dispute: validate(
    z.object({
      order_id: z.coerce.number().int().positive('order_id must be a positive integer'),
      reason: z
        .string()
        .min(1, 'reason is required')
        .max(1000, 'reason must be 1000 characters or fewer')
        .trim(),
    })
  ),

  resolveDispute: validate(
    z.object({
      status: z.enum(['under_review', 'resolved']),
      resolution: z.string().max(1000, 'resolution must be 1000 characters or fewer').optional(),
    })
  ),

  // monthly_limit: 0 disables the budget guard, >0 enforces it, <0 or non-numeric rejected
  updateBudget: validate(
    z.object({
      monthly_limit: z
        .number({
          invalid_type_error: 'monthly_limit must be a number',
          required_error: 'monthly_limit is required',
        })
        .nonnegative('monthly_limit cannot be negative'),
    })
  ),

  verify2FA: validate(
    z.object({
      secret: z.string().min(1, 'secret is required'),
      code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit number'),
      backupCodes: z.array(z.string()).min(1, 'at least one backup code is required'),
    })
  ),

  auction: validate(
    z
      .object({
        product_id: z.coerce.number().int().positive(),
        start_price: z.coerce.number().positive(),
        reserve_price: z.coerce.number().positive().optional(),
        min_increment: z.coerce.number().nonnegative().optional().default(0),
        ends_at: z.string().datetime({ offset: true }),
      })
      .passthrough()
  ),
  bid: validate(
    z
      .object({ amount: z.coerce.number().positive('amount must be a positive number') })
      .passthrough()
  ),
  bundle: validate(
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.coerce.number().positive(),
        items: z
          .array(
            z
              .object({
                product_id: z.coerce.number().int().positive(),
                quantity: z.coerce.number().int().positive(),
              })
              .passthrough()
          )
          .min(1),
      })
      .passthrough()
  ),
  bundlePurchase: validate(
    z.object({ bundle_id: z.coerce.number().int().positive() }).passthrough()
  ),
  flashSale: validate(
    z
      .object({
        flash_sale_price: z.coerce.number().positive().nullable().optional(),
        flash_sale_starts_at: z.string().datetime({ offset: true }).nullable().optional(),
        flash_sale_ends_at: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .passthrough()
  ),
  paymentStream: validate(
    z
      .object({
        contract_id: z.string().min(1),
        recipient: z.string().min(1),
        rate_per_second: z.coerce.number().positive(),
        deposit: z.coerce.number().positive(),
        end_time: z.coerce.number().int().positive(),
      })
      .passthrough()
  ),
  paymentStreamRate: validate(z.object({ new_rate: z.coerce.number().positive() }).passthrough()),
  cooperative: validate(z.object({ name: z.string().trim().min(1).max(120) }).passthrough()),
  cooperativeMultisig: validate(
    z
      .object({
        member_ids: z.array(z.coerce.number().int().positive()).min(1),
        threshold: z.coerce.number().int().positive(),
      })
      .passthrough()
  ),
  cooperativeTransaction: validate(
    z
      .object({
        destination: z.string().min(1),
        amount: z.coerce
          .number()
          .positive()
          .refine((v) => Number(v.toFixed(7)) === v, 'amount must have at most 7 decimal places'),
        memo: z.string().max(28).optional(),
      })
      .passthrough()
  ),
  cooperativeRoyalty: validate(
    z.object({ royalty_bps: z.coerce.number().int().min(0).max(10000) }).passthrough()
  ),
  cooperativeAdmin: validate(
    z.object({ new_admin_id: z.coerce.number().int().positive() }).passthrough()
  ),
  calendar: validate(
    z
      .object({
        product_id: z.coerce.number().int().positive(),
        available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        available_until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional().default('none'),
        recurrence_end: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .passthrough()
  ),
  walletBudgetPut: validate(
    z.object({ limit_xlm: z.coerce.number().nonnegative().nullable() }).passthrough()
  ),
};
