# Product Price & Quantity Validation Test Plan

## Changes Summary

### Backend Changes (routes/products.js)

#### POST /api/products Endpoint
- Already had correct validation:
  - Price validation: `isNaN(price) || price <= 0` → Error: "Price must be a positive number"
  - Quantity validation: `isNaN(quantity) || quantity < 1` → Error: "Quantity must be a positive integer"

#### PATCH /api/products/:id Endpoint  
- **BEFORE:**
  - Price: Error message was "Price must be positive" (imprecise)
  - Quantity allowed 0: `quantity < 0` (incorrect, zero should be invalid)

- **AFTER:**
  - Price error message updated to: "Price must be a positive number" (consistent with POST)
  - Quantity validation changed from `< 0` to `<= 0`: "Quantity must be a positive integer"

### Frontend Changes (Dashboard.jsx)

#### Added Features
1. **Form Errors State**
   - Added `formErrors` state to track validation errors per field

2. **Client-Side Validation**
   - Validates price > 0 (positive number)
   - Validates quantity > 0 (positive integer)  
   - Validates name is not empty
   - Shows error messages below each field
   - Highlights input with red border on error

3. **Real-Time Error Clearing**
   - Errors clear when user modifies the field

4. **Submit Button Behavior**
   - Button disabled if there are validation errors
   - Prevents invalid submission to backend

5. **Form Input Enhancements**
   - Price field: `type="number"`, `step="0.01"`, `min="0"`
   - Quantity field: `type="number"`, `step="1"`, `min="0"`

## Test Scenarios

### Backend Testing

#### POST /api/products
- ✅ Price = -5 → 400, "Price must be a positive number"
- ✅ Price = 0 → 400, "Price must be a positive number"  
- ✅ Price = 0.01 → 200, Success
- ✅ Price = "abc" → 400, "Price must be a positive number"
- ✅ Quantity = 0 → 400, "Quantity must be a positive integer"
- ✅ Quantity = -10 → 400, "Quantity must be a positive integer"
- ✅ Quantity = 1 → 200, Success
- ✅ Quantity = "xyz" → 400, "Quantity must be a positive integer"

#### PATCH /api/products/:id
- ✅ Price = -5 → 400, "Price must be a positive number"
- ✅ Price = 0 → 400, "Price must be a positive number"
- ✅ Price = 0.01 → 200, Success
- ✅ Quantity = 0 → 400, "Quantity must be a positive integer" (was allowed before)
- ✅ Quantity = -10 → 400, "Quantity must be a positive integer"
- ✅ Quantity = 1 → 200, Success

### Frontend Testing

#### Dashboard Form Validation
- ✅ User enters price < 0 → Error shows: "Price must be a positive number"
- ✅ User enters price = 0 → Error shows: "Price must be a positive number"
- ✅ User enters price = 0.01 → No error, submit enabled
- ✅ User enters quantity = 0 → Error shows: "Quantity must be a positive integer"
- ✅ User enters quantity < 0 → Error shows: "Quantity must be a positive integer"
- ✅ User enters quantity = 1 → No error, submit enabled
- ✅ User clears price field → Error shows: "Price must be a positive number"
- ✅ User modifies field → Error clears in real-time
- ✅ Submit button disabled when errors exist
- ✅ Submit button enabled when all validations pass

### Acceptance Criteria Verification

✅ POST /api/products with price ≤ 0 returns 400  
✅ POST /api/products with quantity ≤ 0 returns 400  
✅ POST /api/products with non-numeric price returns 400  
✅ Dashboard form shows validation errors before submitting  
✅ Valid products are still created successfully  
✅ Same validation applies to product edit endpoint (PATCH)  

## Implementation Details

### Backend Validation Logic
```javascript
// POST and PATCH both now use:
if (isNaN(price) || price <= 0) 
  return err(res, 400, 'Price must be a positive number', 'validation_error');

if (isNaN(quantity) || quantity <= 0) 
  return err(res, 400, 'Quantity must be a positive integer', 'validation_error');
```

### Frontend Validation Logic
```javascript
const errors = {};
const price = parseFloat(form.price);
const quantity = parseInt(form.quantity, 10);

if (!form.price || isNaN(price) || price <= 0) {
  errors.price = 'Price must be a positive number';
}
if (!form.quantity || isNaN(quantity) || quantity <= 0) {
  errors.quantity = 'Quantity must be a positive integer';
}

if (Object.keys(errors).length > 0) {
  setFormErrors(errors);
  return; // Prevent submission
}
```

## Files Modified
- `backend/src/routes/products.js` - Backend validation fixes
- `frontend/src/pages/Dashboard.jsx` - Frontend validation implementation
