# Rate Limiting Documentation

## Overview

The Farmers Marketplace API implements a multi-tiered rate limiting strategy to prevent abuse while ensuring legitimate users can access the service efficiently. Different endpoints use different rate limiting approaches based on their security requirements.

## Rate Limiting Types

### 1. General Rate Limiting (express-rate-limit)

Most endpoints use simple IP-based rate limiting via `express-rate-limit`:

- **Auth endpoints** (`/api/auth/*`): 10 requests per 15 minutes
- **General API** (`/api/*`): 100 requests per minute  
- **Orders** (`/api/orders/*`): 10 requests per minute

These limits are applied per IP address and are suitable for endpoints where per-user tracking isn't critical.

### 2. Per-User Rate Limiting with Redis Backend

**Critical wallet endpoints use sophisticated per-user rate limiting** with Redis backend for distributed coordination:

- **Wallet funding** (`/api/wallet/fund`, `/api/v1/wallet/fund`): **5 requests per hour per user**
- **Wallet send** (`/api/wallet/send`): **5 requests per minute per user** (configurable)

#### Key Features:

✅ **Per-authenticated-user limiting** - Uses JWT token to identify users, not just IP  
✅ **Redis-backed distributed coordination** - Multiple backend instances share rate limit state  
✅ **Sliding window algorithm** - More accurate than fixed windows  
✅ **Graceful fallback** - Uses in-memory storage if Redis is unavailable  
✅ **Proper error handling** - Continues serving requests even if Redis fails  

## Configuration

### Environment Variables

```bash
# Basic rate limits
RATE_LIMIT_AUTH_MAX=10          # Auth requests per 15min (default: 10)
RATE_LIMIT_GENERAL_MAX=100      # General requests per minute (default: 100)  
RATE_LIMIT_SEND_MAX=5           # Wallet send requests per minute (default: 5)

# Redis for distributed rate limiting (optional)
REDIS_URL=redis://localhost:6379   # Enables Redis backend
```

### Redis Setup

When `REDIS_URL` is configured:
- Wallet endpoints use Redis for distributed rate limiting
- Multiple backend instances coordinate limits correctly
- Sliding window data is shared across all instances

When `REDIS_URL` is **not** configured:
- Falls back to in-memory rate limiting
- Works fine for single-instance deployments
- Each instance maintains separate limits (limits are per-instance, not global)

## Implementation Details

### Wallet Endpoints (`/api/wallet/fund` and `/api/wallet/send`)

```javascript
// Per-user Redis-backed rate limiters
const fundLimiter = createRateLimitPerUser({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Funding limit reached, try again in an hour',
  code: 'rate_limited'
});

const sendLimiter = createRateLimitPerUser({
  windowMs: 60 * 1000, // 1 minute  
  max: parseInt(process.env.RATE_LIMIT_SEND_MAX || '5'),
  message: 'Too many send requests, slow down',
  code: 'rate_limited'
});
```

### Rate Limit Headers

All rate limited endpoints return standard headers:

```http
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 2024-07-27T14:30:00.000Z
Retry-After: 3600
```

### Error Response Format

When rate limited:

```json
{
  "success": false,
  "error": "Funding limit reached, try again in an hour", 
  "code": "rate_limited",
  "retryAfter": 3600
}
```

## Multi-Instance Coordination

### The Problem

With simple `express-rate-limit`, each backend instance maintains its own counters:

```
User makes 5 requests to Instance A → ✅ Allowed (5/5 used on Instance A)
User makes 5 requests to Instance B → ✅ Allowed (5/5 used on Instance B)  
User makes 5 requests to Instance C → ✅ Allowed (5/5 used on Instance C)

Total: 15 requests (should have been limited to 5)
```

### The Solution

With Redis-backed per-user rate limiting:

```
User makes 5 requests to Instance A → ✅ Allowed (5/5 used globally)
User makes 1 request to Instance B → ❌ Rate limited (6/5 exceeds limit)
User makes 1 request to Instance C → ❌ Rate limited (would be 7/5)

Total: 5 requests (correctly enforced across all instances)
```

## Testing

The implementation includes comprehensive tests:

### 1. Basic Functionality (`wallet-rate-limiting.test.js`)
- Per-user rate limiting enforcement
- Environment variable configuration
- Rate limit headers
- Multi-user isolation

### 2. Distributed Coordination (`rate-limiting-distributed.test.js`)  
- Redis backend usage
- Multi-instance coordination simulation
- Fallback to memory store
- Error handling

### 3. Integration Tests
- Real endpoint testing
- CSRF protection interaction
- Authentication integration

## Security Benefits

1. **Abuse Prevention**: Prevents users from overwhelming Stellar Friendbot or making excessive transactions
2. **Fair Usage**: Each user gets their fair share regardless of which backend instance they hit
3. **DDoS Mitigation**: Per-user limiting is more effective than IP-based for authenticated attacks
4. **Resource Protection**: Protects both backend resources and external services (Stellar)

## Deployment Considerations

### Single Instance Deployment
- Redis is optional
- In-memory rate limiting works fine
- Simpler setup, lower resource usage

### Multi-Instance Deployment  
- Redis is **required** for correct rate limiting
- All instances must connect to the same Redis
- Consider Redis clustering for high availability

### Redis Requirements
- Redis 4.0+ (supports sorted sets with scores)
- Persistent storage recommended (for rate limit continuity across Redis restarts)
- Monitor Redis memory usage (stores sliding window data)

## Monitoring

### Rate Limiting Metrics to Track

1. **Rate limit hits per endpoint**
2. **Redis connection health**
3. **Memory vs Redis backend usage**
4. **Average requests per user per window**

### Logs to Monitor

- Redis connection errors
- Rate limiter fallbacks to memory
- Unusual rate limiting patterns (may indicate abuse)

## Future Enhancements

Potential improvements to consider:

1. **Dynamic rate limits** based on user tier/subscription
2. **Burst allowances** for short-term spikes
3. **Geographic rate limiting** for global deployments
4. **Machine learning** based abuse detection
5. **Rate limit analytics dashboard**

## Troubleshooting

### Common Issues

**Rate limiting not working across instances:**
- Verify `REDIS_URL` is configured on all instances
- Check Redis connectivity
- Monitor Redis logs for errors

**Users getting unexpected rate limits:**
- Check if fallback to IP-based limiting is occurring
- Verify JWT token extraction is working
- Review Redis data for the user key

**Performance issues:**
- Monitor Redis latency
- Consider Redis connection pooling
- Check if cleanup of expired data is working

### Debugging Commands

```bash
# Check Redis rate limit data
redis-cli ZRANGE "rate_limit:user:123" 0 -1 WITHSCORES

# Monitor Redis operations
redis-cli MONITOR

# Check memory usage
redis-cli INFO memory
```