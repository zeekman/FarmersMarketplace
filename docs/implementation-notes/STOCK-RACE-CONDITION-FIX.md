# Stock Race Condition Fix - Atomic UPDATE Pattern

## Problem Description

Without atomic stock operations, a race condition can occur when multiple buyers simultaneously purchase the last unit(s) of a product:

### Vulnerable Pattern (Two-Step):
```javascript
// BROKEN - Vulnerable to race condition:
const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

if (product.quantity < qty) {
  throw new Error('Insufficient stock');
}

// Between the check and the update, another request could also pass the check!
db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?')
  .run(qty, productId);
```

### Race Condition Scenario:
1. Product has quantity = 1
2. Buyer A: SELECT product → sees quantity = 1 → passes check
3. Buyer B: SELECT product → sees quantity = 1 → passes check
4. Buyer A: UPDATE → quantity becomes 0 ✓ Success
5. Buyer B: UPDATE → quantity becomes -1 ✗ Should have failed!

Result: **Negative stock** + both orders succeed

---

## Solution: Atomic UPDATE Pattern

### Correct Pattern (Single Atomic Statement):
```javascript
const reserveStock = db.transaction((buyerId, productId, qty, total) => {
  // Atomic stock check + decrement: single UPDATE with WHERE quantity >= ?
  // If multiple concurrent requests try to buy the last units, only one succeeds.
  // Others fail because quantity no longer meets the WHERE condition.
  const deducted = db.prepare(
    'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
  ).run(qty, productId, qty);

  if (deducted.changes === 0) throw new Error('Insufficient stock');

  const order = db.prepare(
    'INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?)'
  ).run(buyerId, productId, qty, total, 'pending');

  return order.lastInsertRowid;
});
```

### How It Prevents Race Conditions:

**The UPDATE statement itself becomes the atomicity boundary:**

```sql
UPDATE products 
SET quantity = quantity - ? 
WHERE id = ? AND quantity >= ?
```

- **SQLite executes this as a single atomic operation**
- **Check and update happen together**, not in separate steps
- **No window for another request to slip in**

### Concurrent Request Scenario With Fix:

1. Product has quantity = 1
2. Buyer A: Enters transaction, UPDATE attempts to decrement with WHERE quantity >= 1
3. Buyer B: Enters transaction, UPDATE attempts to decrement with WHERE quantity >= 1
4. **One UPDATE executes first** (SQLite serializes):
   - Buyer A's UPDATE: quantity = 1 - 1 = 0 ✓ `changes = 1`
5. **Other UPDATE checks WHERE clause**:
   - Buyer B's UPDATE: WHERE quantity >= 1 is FALSE (quantity is now 0) ✗ `changes = 0`
6. Buyer A: Order created successfully
7. Buyer B: Exception caught (`deducted.changes === 0`) → returns 400 "Insufficient stock"

Result: **Stock remains 0, only one order succeeds**

---

## Key Implementation Details

### 1. Single SQL Statement
- The UPDATE includes the condition in the WHERE clause
- Not a separate SELECT + UPDATE
- Prevents any race window

### 2. Check `changes` Count
```javascript
if (deducted.changes === 0) throw new Error('Insufficient stock');
```
- `changes` = number of rows affected by UPDATE
- 0 means WHERE condition was not met (stock insufficient)
- Used to determine if the update succeeded

### 3. Transaction Wrapper
```javascript
const reserveStock = db.transaction((buyerId, productId, qty, total) => {
  // atomic operations here
  return orderId;
});
```
- Ensures all operations within complete together
- If any statement fails, entire transaction rolls back
- No partial state (e.g., stock decremented but order not created)

### 4. Error Handling
```javascript
try {
  orderId = reserveStock(req.user.id, product_id, quantity, totalPrice);
} catch (e) {
  return err(res, 400, e.message, 'insufficient_stock');
}
```
- Catches the "Insufficient stock" error
- Returns 400 to client
- No stock restoration needed (stock was never decremented)

---

## Acceptance Criteria Verification

✅ **Concurrent purchases of the last unit result in only one successful order**
- Only first buyer's UPDATE succeeds (changes = 1)
- Second buyer's UPDATE fails (changes = 0, quantity doesn't meet WHERE condition)

✅ **The losing concurrent request receives a 400 'Insufficient stock' error**
- When deducted.changes === 0, thrown error caught and formatted as 400 response

✅ **Stock never goes negative**
- WHERE quantity >= ? prevents UPDATE from executing if insufficient stock
- Quantity cannot go below requested amount per request

✅ **The fix uses a single atomic SQL statement**
- UPDATE ... WHERE pattern is atomic in SQLite
- No separate SELECT query or multi-step process

✅ **Existing order flow still works correctly for normal purchases**
- First buyer after stock replenishment: passes WHERE check, order succeeds
- Multiple sequential buyers when stock is sufficient: all succeed as expected
- Single buyer with insufficient stock: error thrown as before

---

## SQLite Atomicity Guarantee

From SQLite documentation:
- Each SQL statement is atomic
- Commands within a transaction are serialized by SQLite
- WHERE clauses are evaluated before UPDATE
- If WHERE condition is false, no rows are modified (changes = 0)

---

## Testing Scenarios

### Scenario 1: Normal Purchase (Stock Available)
- Product quantity = 10
- Buyer requests quantity = 3
- UPDATE: 10 - 3 = 7 ✓ succeeds
- Order created, status = pending

### Scenario 2: Insufficient Stock (Sequential)
- Product quantity = 2
- Buyer A requests quantity = 2 ✓ succeeds (quantity = 0)
- Buyer B requests quantity = 1 ✗ fails (WHERE condition false)
- Response: 400 "Insufficient stock"

### Scenario 3: Race Condition (Concurrent - Last Unit)
- Product quantity = 1
- Buyer A & B both request quantity = 1 concurrently
- First to execute: ✓ succeeds (quantity = 0)
- Second to execute: ✗ fails (WHERE quantity >= 1 is false)
- Result: One order created, one gets 400 error

### Scenario 4: Multiple Units Race
- Product quantity = 3
- Buyer A requests 2, Buyer B requests 2 concurrently
- Buyer A: ✓ succeeds (quantity = 1)
- Buyer B: ✗ fails (WHERE quantity >= 2 is false)
- Result: Stock = 1, only one order created

### Scenario 5: Payment Failure Handling
- Product quantity = 10
- UPDATE succeeds, order created (quantity = 7)
- Payment fails (Stellar network error)
- Catch block: quantity restored: 7 + 3 = 10 ✓
- Order status set to failed
- User can retry

---

## Files Modified

- `backend/src/routes/orders.js` - Added detailed comment explaining atomic pattern

## Files NOT Modified (Already Correct)

- No changes needed to payment logic or error handling
- Atomic pattern was already in place and working correctly
- Enhancement is documentation for future maintainers

---

## Related Concepts

**MVCC (Multi-Version Concurrency Control):**
- SQLite uses locking, not MVCC
- Provides simpler, more predictable behavior for this use case

**Isolation Level:**
- This implementation uses default "deferred" transaction mode
- Sufficient for this pattern since UPDATE automatically acquires lock

**Alternative Not Recommended:**
- Could use SELECT ... FOR UPDATE (feature in PostgreSQL/MySQL)
- SQLite doesn't support FOR UPDATE
- Our pattern is more efficient for SQLite

