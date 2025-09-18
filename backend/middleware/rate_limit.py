"""
Rate limiting middleware with Redis backend using slowapi
"""
import time
import json
from typing import Tuple
from fastapi import Request
from fastapi.responses import JSONResponse
import redis.asyncio as redis
import structlog
import os
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

logger = structlog.get_logger()


# Initialize Redis connection
def get_redis_connection():
    """Get Redis connection for rate limiting"""
    # Check if Redis is enabled
    redis_enabled = os.getenv("REDIS_ENABLED", "true").lower() == "true"
    if not redis_enabled:
        logger.info(
            "Redis disabled via REDIS_ENABLED=false, using in-memory \
                    rate limiting")
        return None

    try:
        # Try URL first
        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            return redis.from_url(redis_url, decode_responses=True)

        # Build connection from individual components
        redis_host = os.getenv("REDIS_HOST", "localhost")
        redis_port = int(os.getenv("REDIS_PORT", "6379"))
        redis_db = int(os.getenv("REDIS_DB", "0"))
        redis_password = os.getenv("REDIS_PASSWORD") or None

        return redis.Redis(
            host=redis_host,
            port=redis_port,
            db=redis_db,
            password=redis_password,
            decode_responses=True
        )
    except Exception as e:
        # Fallback to in-memory if Redis is not available
        logger.warning(
            f"Redis connection failed: {e}, using in-memory rate limiting"
        )
        return None


# Initialize slowapi limiter with configurable limits
default_ip_limit = os.getenv("RATE_LIMIT_IP_REQUESTS", "50")

# Configure slowapi storage
redis_enabled = os.getenv("REDIS_ENABLED", "true").lower() == "true"
if redis_enabled:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    storage_uri = redis_url
else:
    # Use in-memory storage for slowapi
    storage_uri = "memory://"

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=storage_uri,
    # Configurable requests per hour per IP
    default_limits=[f"{default_ip_limit}/hour"]
)

# Simple in-memory rate limiter as backup


class SimpleRateLimiter:
    def __init__(self):
        self.requests = {}  # ip -> list of timestamps
        self.limit = int(os.getenv("RATE_LIMIT_IP_REQUESTS", "50"))
        # Configurable window
        self.window = int(os.getenv("RATE_LIMIT_WINDOW", "3600"))

    def check_rate_limit(self, ip: str) -> bool:
        """Check if IP is within rate limit"""
        now = time.time()

        # Clean old entries
        if ip not in self.requests:
            self.requests[ip] = []

        # Remove old timestamps
        self.requests[ip] = [
            timestamp for timestamp in self.requests[ip]
            if now - timestamp < self.window
        ]

        # Check if limit exceeded
        if len(self.requests[ip]) >= self.limit:
            return False

        # Add current request
        self.requests[ip].append(now)
        return True


simple_rate_limiter = SimpleRateLimiter()

# Token tracking for cost control


class TokenTracker:
    """Track token usage for cost control"""

    def __init__(self):
        self.redis = get_redis_connection()
        self.ip_token_limit = int(
            os.getenv("RATE_LIMIT_IP_TOKENS", "10000"))  # per hour
        self.global_token_limit = int(
            os.getenv("RATE_LIMIT_GLOBAL_TOKENS", "100000"))  # per hour
        # Configurable window
        self.window = int(os.getenv("RATE_LIMIT_WINDOW", "3600"))

    async def check_token_limits(self, ip: str, estimated_tokens: int) -> \
            Tuple[bool, str]:
        """Check if token usage is within limits"""
        if not self.redis:
            return True, ""  # Allow if Redis is not available

        # Use configurable window for time bucketing
        current_bucket = int(time.time() // self.window)

        # Check IP token limit
        ip_key = f"tokens:ip:{ip}:{current_bucket}"
        ip_tokens = await self.redis.get(ip_key) or 0
        ip_tokens = int(ip_tokens)

        if ip_tokens + estimated_tokens > self.ip_token_limit:
            return False, f"IP token limit exceeded. Used: \
                    {ip_tokens}/{self.ip_token_limit}"

        # Check global token limit
        global_key = f"tokens:global:{current_bucket}"
        global_tokens = await self.redis.get(global_key) or 0
        global_tokens = int(global_tokens)

        if global_tokens + estimated_tokens > self.global_token_limit:
            return False, f"Global token limit exceeded. Used: \
                    {global_tokens}/{self.global_token_limit}"

        return True, ""

    async def consume_tokens(self, ip: str, tokens: int):
        """Record token consumption"""
        if not self.redis:
            return

        current_bucket = int(time.time() // self.window)

        # Update IP tokens
        ip_key = f"tokens:ip:{ip}:{current_bucket}"
        await self.redis.incrby(ip_key, tokens)
        # Expire after configured window
        await self.redis.expire(ip_key, self.window)

        # Update global tokens
        global_key = f"tokens:global:{current_bucket}"
        await self.redis.incrby(global_key, tokens)
        await self.redis.expire(global_key, self.window)

        logger.info(
            "Token usage recorded",
            ip=ip,
            tokens=tokens,
            bucket=current_bucket,
            window=self.window
        )


# Global token tracker
token_tracker = TokenTracker()


def estimate_tokens(text: str) -> int:
    """Rough estimation of tokens for rate limiting purposes"""
    # Simple estimation: ~4 characters per token for English text
    return max(len(text) // 4, 10)  # Minimum 10 tokens


async def token_limit_middleware(request: Request, call_next):
    """Token-based cost control middleware"""

    # Skip for non-AI endpoints
    if not request.url.path.startswith("/api/ai/"):
        return await call_next(request)

    # Get client IP
    client_ip = get_remote_address(request)

    # Check basic rate limit first (requests per hour)
    if not simple_rate_limiter.check_rate_limit(client_ip):
        logger.warning(
            "Request rate limit exceeded",
            ip=client_ip,
            path=request.url.path
        )
        return JSONResponse(
            status_code=429,
            content={
                "error": "Rate limit exceeded",
                "message": f"Too many requests. Limit: \
                        {simple_rate_limiter.limit} requests per \
                        {simple_rate_limiter.window} seconds",
                "retry_after": simple_rate_limiter.window
            },
            headers={"Retry-After": str(simple_rate_limiter.window)}
        )

    # Estimate tokens for POST requests
    estimated_tokens = 0
    if request.method == "POST":
        try:
            body = await request.body()
            if body:
                try:
                    data = json.loads(body)
                    if "message" in data:
                        estimated_tokens = estimate_tokens(data["message"])
                        if "current_file_content" in data and \
                                data["current_file_content"]:
                            estimated_tokens += estimate_tokens(
                                data["current_file_content"])
                        # Add buffer for system prompt and response
                        estimated_tokens = int(estimated_tokens * 1.5)
                except json.JSONDecodeError:
                    estimated_tokens = 100

            # Recreate request with body
            async def receive():
                return {"type": "http.request", "body": body}
            request._receive = receive

        except Exception as e:
            logger.warning("Failed to estimate tokens", error=str(e))
            estimated_tokens = 100

    # Check token limits
    if estimated_tokens > 0:
        allowed, error_msg = await token_tracker.\
            check_token_limits(client_ip, estimated_tokens)
        if not allowed:
            logger.warning(
                "Token limit exceeded",
                ip=client_ip,
                estimated_tokens=estimated_tokens,
                error=error_msg
            )

            return JSONResponse(
                status_code=429,
                content={
                    "error": "Token limit exceeded",
                    "message": error_msg,
                    "retry_after": token_tracker.window
                },
                headers={"Retry-After": str(token_tracker.window)}
            )

        # Pre-consume estimated tokens
        await token_tracker.consume_tokens(client_ip, estimated_tokens)

    # Process request
    response = await call_next(request)

    # Add token limit headers
    if estimated_tokens > 0:
        response.headers["X-RateLimit-Estimated-Tokens"] = str(
            estimated_tokens)

    return response

# Custom rate limit exceeded handler


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Custom handler for rate limit exceeded"""
    logger.warning(
        "Rate limit exceeded",
        ip=get_remote_address(request),
        path=request.url.path,
        limit=str(exc.detail)
    )

    window = int(os.getenv("RATE_LIMIT_WINDOW", "3600"))
    return JSONResponse(
        status_code=429,
        content={
            "error": "Rate limit exceeded",
            "message": f"Too many requests. Limit: {exc.detail}",
            "retry_after": window
        },
        headers={"Retry-After": str(window)}
    )
