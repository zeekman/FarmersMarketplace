# Services

This directory contains service classes that encapsulate business logic for the marketplace application.

## WaitlistService

The `WaitlistService` class handles all waitlist-related operations for out-of-stock products.

### Features

- **FIFO Ordering**: Waitlist entries are processed in first-in-first-out order based on creation timestamp
- **Position Management**: Automatic position calculation and recalculation when entries are added/removed
- **Validation**: Input validation using the WaitlistEntry model
- **Error Handling**: Comprehensive error handling with descriptive messages
- **Database Integration**: Works with both PostgreSQL and SQLite through the existing database layer

### Methods

#### `joinWaitlist(buyerId, productId, quantity)`
Adds a buyer to the waitlist for an out-of-stock product.

**Parameters:**
- `buyerId` (number): The buyer's user ID
- `productId` (number): The product ID to join waitlist for
- `quantity` (number): Desired quantity

**Returns:** Promise resolving to `{success, position?, totalWaiting?, entry?, error?}`

#### `leaveWaitlist(buyerId, productId)`
Removes a buyer from the waitlist and updates positions for remaining entries.

**Parameters:**
- `buyerId` (number): The buyer's user ID
- `productId` (number): The product ID to leave waitlist for

**Returns:** Promise resolving to `{success, message?, error?}`

#### `getWaitlistStatus(buyerId, productId)`
Gets the waitlist status for a specific buyer and product.

**Parameters:**
- `buyerId` (number): The buyer's user ID
- `productId` (number): The product ID to check

**Returns:** Promise resolving to `{success, onWaitlist, position?, totalWaiting, error?}`

#### `getBuyerWaitlistEntries(buyerId)`
Gets all waitlist entries for a buyer with product details.

**Parameters:**
- `buyerId` (number): The buyer's user ID

**Returns:** Promise resolving to `{success, data?, error?}`

#### `getProductWaitlistEntries(productId, limit?)`
Gets waitlist entries for a product in FIFO order.

**Parameters:**
- `productId` (number): The product ID
- `limit` (number, optional): Maximum number of entries to return

**Returns:** Promise resolving to `{success, data?, error?}`

#### `getWaitlistCount(productId)`
Gets the total number of people waiting for a product.

**Parameters:**
- `productId` (number): The product ID

**Returns:** Promise resolving to `{success, count?, error?}`

#### `recalculatePositions(productId)`
Recalculates positions for all entries in a product's waitlist based on creation time.

**Parameters:**
- `productId` (number): The product ID

**Returns:** Promise resolving to `{success, updated?, error?}`

### Usage Example

```javascript
const WaitlistService = require('./WaitlistService');

const service = new WaitlistService();

// Join waitlist
const result = await service.joinWaitlist(123, 456, 2);
if (result.success) {
  console.log(`Joined waitlist at position ${result.position}`);
}

// Check status
const status = await service.getWaitlistStatus(123, 456);
if (status.success && status.onWaitlist) {
  console.log(`Currently at position ${status.position} of ${status.totalWaiting}`);
}
```

### Integration Points

The WaitlistService integrates with:
- **Database Layer**: Uses the existing `db/schema` module for database operations
- **WaitlistEntry Model**: Uses the WaitlistEntry class for data validation and serialization
- **Product System**: Checks product existence and stock levels
- **User System**: Validates buyer IDs through foreign key constraints

### Error Handling

The service provides comprehensive error handling for:
- Invalid input parameters
- Product not found
- Product in stock (cannot join waitlist)
- Already on waitlist
- Not on waitlist (cannot leave)
- Database connection errors

All methods return a consistent response format with `success` boolean and either data or error message.