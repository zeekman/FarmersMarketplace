# Refactor Soroban RPC Health Check to Use Shared Client

## Description

Refactors the Soroban RPC health check implementation to eliminate code duplication by using shared client utilities instead of raw HTTP requests. This change centralizes configuration management and ensures consistent error handling across all Soroban RPC interactions.

## Problem

The existing architecture had (or would have had) `checkSorobanRPC()` using raw `Node.js https.request` calls, duplicating URL parsing, header setting, and error handling logic that already exists in the Stellar utilities. This meant:

- **Code duplication**: Two independent HTTP clients for the same RPC endpoint
- **Maintenance burden**: Future changes (auth headers, RPC provider switches) require updates in multiple places
- **Inconsistent error handling**: Different error patterns between health checks and contract operations

## Solution

### Changes Made

1. **Enhanced `backend/src/utils/stellar.js`**:
   - Added `getSorobanServer()` function for centralized server instance creation
   - Added `checkSorobanRPC()` function using the shared Stellar SDK client
   - Refactored `getContractState()` to use the shared server instance
   - Eliminated potential raw HTTP request code

2. **Created `backend/src/routes/health.js`**:
   - Comprehensive health check endpoints using shared utilities
   - Basic endpoint: `GET /api/health` (unchanged behavior)
   - Detailed endpoint: `GET /api/health/detailed` (new, includes Soroban status)
   - Both available under `/api/v1/` namespace

3. **Cleaned up `backend/src/routes/index.js`**:
   - Removed scattered duplicate health check routes  
   - Centralized routing through health module
   - Health checks bypass rate limiting for monitoring

4. **Added comprehensive test coverage** in `backend/tests/health.test.js`:
   - Tests healthy, unhealthy, and error scenarios
   - Validates response shape preservation
   - Covers both versioned and unversioned endpoints

### Key Benefits

- **DRY principle**: Single source of configuration for all Soroban RPC interactions
- **Future-proof**: Configuration changes only need updates in one place
- **Consistent**: All Soroban operations use the same client and error handling
- **Maintainable**: Clean separation of concerns with reusable utilities
- **Monitorable**: Proper HTTP status codes and detailed error information

### Response Shape Preservation

The health check endpoints maintain the documented response shape:
```json
{
  "status": "ok|degraded|error",
  "responseTime": 123,
  "timestamp": "2026-07-27T09:00:00.000Z",
  "version": "v1",
  "services": {
    "soroban": {
      "status": "healthy|unhealthy",
      "responseTime": 89,
      "details": {
        "status": "healthy",
        "latestLedger": 12345,
        "oldestLedger": 12000,
        "ledgerRetentionWindow": 345
      }
    }
  }
}
```

## Testing

- ✅ All existing health check behavior preserved
- ✅ New comprehensive test suite added
- ✅ Basic `/api/health` endpoints return same `{status: 'ok'}` response
- ✅ Detailed endpoints provide service-specific status information
- ✅ Proper HTTP status codes (200 for healthy, 503 for unhealthy)

## Acceptance Criteria

- ✅ `checkSorobanRPC()` uses shared Soroban client/config utility instead of raw `https.request`
- ✅ Existing health-check test coverage continues to pass unchanged in behavior  
- ✅ No alteration to documented health-check response shape (status, responseTime, details/error)
- ✅ Future changes to RPC configuration only require updates in one place

## Migration Notes

This is a backward-compatible change:
- All existing health check endpoints work exactly the same
- No breaking changes to API contracts
- Additional detailed health endpoints are new features
- Configuration consolidation is internal (no env var changes needed)

## Future Enhancements Made Possible

With centralized configuration, future enhancements become trivial:
- Adding authentication headers to RPC calls
- Switching to different RPC providers
- Implementing retry logic or circuit breakers
- Adding request/response logging
- Implementing health check caching

All such changes would only require modifications in `getSorobanServer()` and `checkSorobanRPC()` functions.