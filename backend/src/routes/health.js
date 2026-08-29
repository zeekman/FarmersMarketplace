const router = require('express').Router();
const { checkSorobanRPC } = require('../utils/stellar');

// Basic health check
router.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

// Comprehensive health check with external dependencies
router.get('/health/detailed', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Check Soroban RPC health using shared client
    const sorobanHealth = await checkSorobanRPC();
    
    const overallResponseTime = Date.now() - startTime;
    const isHealthy = sorobanHealth.status === 'healthy';
    
    const response = {
      status: isHealthy ? 'ok' : 'degraded',
      responseTime: overallResponseTime,
      timestamp: new Date().toISOString(),
      version: 'v1',
      services: {
        soroban: sorobanHealth
      }
    };
    
    // Return 200 for healthy, 503 for unhealthy
    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json(response);
    
  } catch (error) {
    const overallResponseTime = Date.now() - startTime;
    res.status(503).json({
      status: 'error',
      responseTime: overallResponseTime,
      timestamp: new Date().toISOString(),
      version: 'v1',
      error: error.message,
      services: {
        soroban: {
          status: 'error',
          error: error.message
        }
      }
    });
  }
});

module.exports = router;