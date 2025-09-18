"""
Main FastAPI application for Nano Contracts IDE
"""
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog
import os

from api.ai_assistant import router as ai_assistant_router
from middleware.rate_limit import limiter, token_limit_middleware, \
    rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Load environment variables from .env file
load_dotenv()


logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    logger.info("Starting Nano Contracts IDE Backend")

    # Initialize services here if needed

    yield

    # Shutdown
    logger.info("Shutting down Nano Contracts IDE Backend")


# Create FastAPI application
app = FastAPI(
    title="Nano Contracts IDE API",
    description="Backend API for Hathor Nano Contracts IDE",
    version="1.0.0",
    lifespan=lifespan,
)

# Add slowapi to the app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# Configure CORS - Allow all origins
logger.info("CORS configured to allow all origins")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add token-based cost control middleware
app.middleware("http")(token_limit_middleware)

# Include routers
app.include_router(
    ai_assistant_router, prefix="/api/ai", tags=["ai-assistant"]
)


@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Nano Contracts IDE API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler"""
    logger.error("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"message": "Internal server error"}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
