# POST /api/products/:id/waitlist Endpoint Implementation

## Overview

Successfully implemented the POST /api/products/:id/waitlist endpoint as specified in task 6.1 of the product waitlist spec. The endpoint allows authenticated buyers to join waitlists for out-of-stock products.

## Implementation Details

### 1. Route Handler
- **Location**: `backend/src/routes/products.js`
- **Method**: POST
- **Path**: `/api/products/:id/waitlist`
- **Authentication**: Required (buyers only)
- **Validation**: Uses `validate.waitlist` middleware

### 2. Validation Schema
- **Location**: `backend/src/middleware/validate.js`
- **Schema**: Added `waitlist` validation schema
- **Rules**:
  - `quantity`: Required positive integer, max 1000 units
  - Validates using Zod schema with coercion and constraints

### 3. Authentication & Authorization
- **Middleware**: Uses existing `auth` middleware
- **Role Check**: Only buyers can join waitlists (farmers rejected with 403)
- **Token**: Requires valid JWT token in Authorization header

### 4. Service Integration
- **Service**: Integrates with `WaitlistService.joinWaitlist()` method
- **Parameters**: `buyerId`, `productId`, `quantity`
- **Error Handling**: Comprehensive error code mapping to HTTP status codes

### 5. HTTP Status Code Mapping
```javascript
BUYER_NOT_FOUND     -> 404
PRODUCT_NOT_FOUND   -> 404
DUPLICATE_ENTRY     -> 409 (Already on waitlist)
INVALID_ROLE        -> 403
ACCOUNT_INACTIVE    -> 403
PRODUCT_INACTIVE    -> 403
PRODUCT_IN_STOCK    -> 400 (Product available for purchase)
INTERNAL_ERROR      -> 500
Default             -> 400
```

### 6. Response Format

#### Success Response (200)
```json
{
  "success": true,
  "position": 1,
  "totalWaiting": 5,
  "message": "Successfully joined waitlist at position 1"
}
```

#### Error Response (4xx/5xx)
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### 7. API Documentation
- **Swagger/OpenAPI**: Complete documentation with request/response schemas
- **Tags**: Categorized under "Products"
- **Security**: Documents bearer token requirement
- **Examples**: Includes parameter examples and response formats

## Request/Response Examples

### Valid Request
```bash
POST /api/products/123/waitlist
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "quantity": 2
}
```

### Success Response
```json
{
  "success": true,
  "position": 3,
  "totalWaiting": 8,
  "message": "Successfully joined waitlist at position 3"
}
```

### Error Examples

#### Farmer Trying to Join (403)
```json
{
  "success": false,
  "error": "Only buyers can join waitlists",
  "code": "forbidden"
}
```

#### Product In Stock (400)
```json
{
  "success": false,
  "error": "Product \"Organic Tomatoes\" is currently available for purchase with 15 units in stock",
  "code": "PRODUCT_IN_STOCK"
}
```

#### Already on Waitlist (409)
```json
{
  "success": false,
  "error": "Already on waitlist for this product at position 2 (joined 12/15/2023)",
  "code": "DUPLICATE_ENTRY"
}
```

## Integration Points

### 1. WaitlistService
- Uses existing `WaitlistService` class
- Calls `joinWaitlist(buyerId, productId, quantity)` method
- Handles all business logic validation and database operations

### 2. Existing Middleware
- **Authentication**: Reuses `auth` middleware from existing endpoints
- **Validation**: Extends `validate` middleware with new `waitlist` schema
- **Error Handling**: Uses existing `err` utility function

### 3. Database Integration
- Service handles all database operations through existing `db` abstraction
- Supports both PostgreSQL and SQLite through existing dual-database setup
- Uses transactions for atomic operations

## Security Features

### 1. Input Validation
- Product ID validation (positive integer)
- Quantity validation (1-1000 range)
- Request body sanitization through Zod schema

### 2. Authorization
- JWT token verification
- Role-based access control (buyers only)
- User ownership validation handled by service

### 3. Error Handling
- No sensitive information leaked in error messages
- Consistent error response format
- Proper HTTP status codes

## Testing

### 1. Unit Tests
- **Location**: `backend/src/__tests__/waitlist-endpoint.test.js`
- **Coverage**: Authentication, validation, service integration, error handling
- **Mocking**: Database and service dependencies mocked

### 2. Test Scenarios
- ✅ Successful waitlist join
- ✅ Farmer role rejection
- ✅ Missing authentication
- ✅ Invalid quantity validation
- ✅ Invalid product ID validation
- ✅ Service error handling
- ✅ Duplicate entry handling
- ✅ Product in stock handling

## Requirements Compliance

### Requirement 5.1 ✅
- POST /api/products/:id/waitlist endpoint implemented
- Proper HTTP method and path structure

### Requirement 5.3 ✅
- Valid buyer authentication required
- Product ID parameter validation
- Quantity parameter validation and sanitization

### Requirements 1.1, 1.2, 1.3 ✅
- Integrates with WaitlistService for entry creation
- Handles duplicate prevention
- Validates product stock status

## Files Modified

1. **backend/src/routes/products.js**
   - Added WaitlistService import
   - Added POST /api/products/:id/waitlist endpoint
   - Added comprehensive Swagger documentation

2. **backend/src/middleware/validate.js**
   - Added `waitlist` validation schema
   - Quantity validation with proper constraints

3. **backend/src/__tests__/waitlist-endpoint.test.js** (New)
   - Comprehensive unit tests for endpoint functionality

## Next Steps

The endpoint is fully implemented and ready for integration testing. The next tasks in the spec would be:

- Task 6.2: Implement DELETE /api/products/:id/waitlist endpoint
- Task 6.3: Implement GET /api/products/:id/waitlist/status endpoint
- Task 6.4: Implement GET /api/waitlist/mine endpoint

## Notes

- The endpoint follows existing API patterns in the codebase
- Error handling is consistent with other endpoints
- Documentation follows existing Swagger conventions
- Service integration allows for easy testing and maintenance
- The implementation is production-ready with proper validation and security