# Rate Limiting Configuration

## Environment Variables

Configure rate limiting through the following environment variables:

### Request Rate Limits
- `RATE_LIMIT_IP_REQUESTS` - Maximum requests per IP per window (default: 50)
- `RATE_LIMIT_GLOBAL_REQUESTS` - Maximum global requests per window (default: 1000)

### Token Rate Limits (Cost Control)
- `RATE_LIMIT_IP_TOKENS` - Maximum tokens per IP per window (default: 10000)
- `RATE_LIMIT_GLOBAL_TOKENS` - Maximum global tokens per window (default: 100000)

### Time Window
- `RATE_LIMIT_WINDOW` - Rate limiting window in seconds (default: 3600 = 1 hour)

### Redis Configuration
- `REDIS_ENABLED` - Enable/disable Redis (default: true, set to 'false' for in-memory)
- `REDIS_URL` - Redis connection URL (default: redis://localhost:6379/0)
- `REDIS_HOST` - Redis host (default: localhost)
- `REDIS_PORT` - Redis port (default: 6379)
- `REDIS_DB` - Redis database number (default: 0)
- `REDIS_PASSWORD` - Redis password (optional)

## Example Configuration

### Production with Redis
```bash
# Enable Redis for distributed rate limiting
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379/0

# Conservative limits for production
RATE_LIMIT_IP_REQUESTS=30
RATE_LIMIT_GLOBAL_REQUESTS=500
RATE_LIMIT_IP_TOKENS=5000
RATE_LIMIT_GLOBAL_TOKENS=50000
RATE_LIMIT_WINDOW=3600
```

### Development without Redis
```bash
# Disable Redis, use in-memory rate limiting
REDIS_ENABLED=false

# More permissive limits for development
RATE_LIMIT_IP_REQUESTS=100
RATE_LIMIT_GLOBAL_REQUESTS=2000
RATE_LIMIT_IP_TOKENS=20000
RATE_LIMIT_GLOBAL_TOKENS=200000
RATE_LIMIT_WINDOW=3600
```

### Redis with Authentication
```bash
# Redis with password and custom settings
REDIS_ENABLED=true
REDIS_HOST=redis.example.com
REDIS_PORT=6380
REDIS_DB=1
REDIS_PASSWORD=your_redis_password
```

## Rate Limiting Tiers

The system implements multiple tiers of protection:

1. **Request-based limits** - Basic request counting per IP
2. **Token-based limits** - AI usage cost control per IP and globally
3. **Slowapi integration** - Distributed rate limiting with Redis
4. **Fallback protection** - In-memory limits when Redis is unavailable

## Deployment Modes

### With Redis (Recommended for Production)
- ✅ Distributed rate limiting across multiple instances
- ✅ Persistent rate limit data
- ✅ Advanced token tracking
- ✅ Better performance for high traffic

### Without Redis (Development/Single Instance)
- ✅ Simple setup, no external dependencies
- ✅ In-memory rate limiting
- ⚠️ Rate limits reset on restart
- ⚠️ Not suitable for multiple instances

## Monitoring

### Check Redis Connection Status
The application logs will indicate the Redis status:
```
INFO: Redis disabled via REDIS_ENABLED=false, using in-memory rate limiting
WARN: Redis connection failed: [error], using in-memory rate limiting
```

### Monitor Redis Usage
Check Redis keys for current usage:
```bash
# IP token tracking
redis-cli KEYS "tokens:ip:*"

# Global token usage  
redis-cli KEYS "tokens:global:*"

# Check specific IP usage
redis-cli GET "tokens:ip:127.0.0.1:12345"
```