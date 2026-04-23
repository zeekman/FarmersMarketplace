/**
 * Example usage of AutomaticOrderProcessor
 *
 * Demonstrates how to integrate the AutomaticOrderProcessor with the existing
 * product restock functionality to automatically process waitlist entries.
 */

const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');
const WaitlistService = require('../services/WaitlistService');
const db = require('../db/schema');

/**
 * Example: Process waitlist when a product is restocked
 * This would typically be called from the product restock endpoint
 */
async function exampleRestockWithWaitlistProcessing(productId, newQuantity) {
  console.log(`\n=== Restock Example: Product ${productId} with ${newQuantity} units ===`);

  try {
    // 1. Update product quantity (existing functionality)
    await db.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2', [
      newQuantity,
      productId,
    ]);

    console.log(`✓ Updated product ${productId} stock by +${newQuantity} units`);

    // 2. Get current product details
    const { rows: productRows } = await db.query('SELECT * FROM products WHERE id = $1', [
      productId,
    ]);

    if (!productRows[0]) {
      console.log('✗ Product not found');
      return;
    }

    const product = productRows[0];
    console.log(`✓ Product "${product.name}" now has ${product.quantity} units in stock`);

    // 3. Check if there are waitlist entries to process
    const waitlistService = new WaitlistService();
    const waitlistCount = await waitlistService.getWaitlistCount(productId);

    if (!waitlistCount.success || waitlistCount.count === 0) {
      console.log('ℹ No waitlist entries to process');
      return;
    }

    console.log(`ℹ Found ${waitlistCount.count} people on waitlist`);

    // 4. Process waitlist entries automatically
    const processor = new AutomaticOrderProcessor();
    const result = await processor.processWaitlistOnRestock(productId, newQuantity);

    if (result.success) {
      console.log(`✓ Waitlist processing completed:`);
      console.log(`  - Processed: ${result.processed} orders`);
      console.log(`  - Skipped: ${result.skipped} entries`);
      console.log(`  - Remaining stock: ${result.remainingStock} units`);
      console.log(`  - Total entries: ${result.totalEntries}`);

      if (result.errors.length > 0) {
        console.log(`⚠ Errors encountered:`);
        result.errors.forEach((error) => {
          console.log(`  - Entry ${error.entryId}: ${error.error}`);
        });
      }
    } else {
      console.log(`✗ Waitlist processing failed: ${result.error}`);
    }
  } catch (error) {
    console.error('✗ Error during restock processing:', error.message);
  }
}

/**
 * Example: Create a single automatic order
 * This demonstrates the core order creation functionality
 */
async function exampleCreateAutomaticOrder() {
  console.log(`\n=== Single Order Example ===`);

  try {
    // Mock data for demonstration
    const waitlistEntry = {
      id: 1,
      buyer_id: 100,
      product_id: 200,
      quantity: 2,
      position: 1,
    };

    const product = {
      id: 200,
      farmer_id: 300,
      name: 'Organic Tomatoes',
      price: 12.5,
      category: 'vegetables',
      unit: 'kg',
    };

    const buyer = {
      id: 100,
      name: 'John Doe',
      email: 'john@example.com',
      stellar_public_key: 'GTEST_BUYER_PUBLIC_KEY',
      stellar_secret_key: 'STEST_BUYER_SECRET_KEY',
    };

    console.log(`Creating automatic order for ${buyer.name}:`);
    console.log(`  Product: ${product.name} (${waitlistEntry.quantity} ${product.unit})`);
    console.log(`  Total: ${(product.price * waitlistEntry.quantity).toFixed(2)} XLM`);

    const processor = new AutomaticOrderProcessor();
    const result = await processor.createAutomaticOrder(waitlistEntry, product, buyer);

    if (result.success) {
      console.log(`✓ Order created successfully:`);
      console.log(`  - Order ID: ${result.orderId}`);
      console.log(`  - Transaction Hash: ${result.txHash}`);
      console.log(`  - Total Price: ${result.totalPrice} XLM`);
    } else {
      console.log(`✗ Order creation failed: ${result.error}`);
      console.log(`  - Code: ${result.code}`);
    }
  } catch (error) {
    console.error('✗ Error creating automatic order:', error.message);
  }
}

/**
 * Example: Integration with existing product restock endpoint
 * This shows how to modify the existing PATCH /api/products/:id/restock endpoint
 */
function exampleRouteIntegration() {
  console.log(`\n=== Route Integration Example ===`);

  const exampleRouteHandler = `
// PATCH /api/products/:id/restock - Enhanced with waitlist processing
router.patch('/:id/restock', auth, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return err(res, 403, 'Farmers only', 'forbidden');
  }

  const { quantity } = req.body;
  if (!quantity || quantity <= 0) {
    return err(res, 400, 'Positive quantity required', 'validation_error');
  }

  try {
    // 1. Verify farmer owns the product
    const { rows: productRows } = await db.query(
      'SELECT * FROM products WHERE id = $1 AND farmer_id = $2',
      [req.params.id, req.user.id]
    );

    if (!productRows[0]) {
      return err(res, 404, 'Product not found or not yours', 'not_found');
    }

    const product = productRows[0];

    // 2. Update product quantity
    await db.query(
      'UPDATE products SET quantity = quantity + $1, low_stock_alerted = 0 WHERE id = $2',
      [quantity, req.params.id]
    );

    // 3. Process waitlist entries automatically
    const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');
    const processor = new AutomaticOrderProcessor();
    
    const waitlistResult = await processor.processWaitlistOnRestock(
      parseInt(req.params.id), 
      quantity
    );

    // 4. Return response with waitlist processing results
    res.json({
      success: true,
      message: \`Added \${quantity} units to \${product.name}\`,
      waitlistProcessing: waitlistResult.success ? {
        processed: waitlistResult.processed,
        skipped: waitlistResult.skipped,
        remainingStock: waitlistResult.remainingStock,
        errors: waitlistResult.errors
      } : {
        error: waitlistResult.error
      }
    });

  } catch (error) {
    console.error('Restock error:', error);
    return err(res, 500, 'Failed to restock product', 'internal_error');
  }
});
  `;

  console.log('Enhanced route handler code:');
  console.log(exampleRouteHandler);
}

/**
 * Example: Error handling scenarios
 */
async function exampleErrorHandling() {
  console.log(`\n=== Error Handling Examples ===`);

  const processor = new AutomaticOrderProcessor();

  // Example 1: Insufficient balance
  console.log('1. Insufficient Balance Scenario:');
  try {
    const result = await processor.createAutomaticOrder(
      { id: 1, buyer_id: 100, product_id: 200, quantity: 1000 }, // Large quantity
      { id: 200, farmer_id: 300, name: 'Expensive Product', price: 1000000 },
      {
        id: 100,
        name: 'Poor Buyer',
        email: 'poor@example.com',
        stellar_public_key: 'GPOOR_BUYER',
        stellar_secret_key: 'SPOOR_BUYER',
      }
    );
    console.log(`   Result: ${result.success ? 'Success' : 'Failed - ' + result.error}`);
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Example 2: Invalid inputs
  console.log('2. Invalid Input Scenario:');
  try {
    const result = await processor.createAutomaticOrder(null, null, null);
    console.log(`   Result: ${result.success ? 'Success' : 'Failed - ' + result.error}`);
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Example 3: Payment failure
  console.log('3. Payment Failure Scenario:');
  console.log('   (Would be handled by Stellar SDK errors in real implementation)');
}

// Export functions for use in other modules
module.exports = {
  exampleRestockWithWaitlistProcessing,
  exampleCreateAutomaticOrder,
  exampleRouteIntegration,
  exampleErrorHandling,
};

// Run examples if this file is executed directly
if (require.main === module) {
  console.log('🚀 AutomaticOrderProcessor Usage Examples');
  console.log('==========================================');

  // Note: These examples use mock data and won't actually process real orders
  // In a real environment, you would have actual database records and Stellar accounts

  exampleRouteIntegration();

  console.log('\n📝 To run the interactive examples with real data:');
  console.log('   1. Ensure your database has test products and waitlist entries');
  console.log('   2. Configure Stellar testnet accounts with sufficient XLM');
  console.log('   3. Call the example functions with real IDs');
  console.log('\n💡 The AutomaticOrderProcessor is now ready for integration!');
}
