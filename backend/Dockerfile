# Backend Dockerfile - Hathor Nano Contracts IDE API
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV POETRY_NO_INTERACTION=1
ENV POETRY_VIRTUALENVS_CREATE=false
ENV POETRY_HOME="/opt/poetry"
ENV POETRY_VERSION=1.8.3
ENV PATH="/opt/poetry/bin:${PATH}"

# Install system dependencies including Poetry
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && curl -sSL https://install.python-poetry.org | python3 - \
    && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy Poetry configuration files
COPY pyproject.toml poetry.lock ./

# Install dependencies directly to system Python
RUN poetry install --only=main --no-root

# Copy application code
COPY . .

# Create non-root user and give ownership
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app \
    && mkdir -p /home/app/.cache \
    && chown -R app:app /home/app
USER app

# Set default environment variables for rate limiting
ENV REDIS_ENABLED=true
ENV REDIS_URL=redis://redis:6379/0
ENV RATE_LIMIT_IP_REQUESTS=50
ENV RATE_LIMIT_GLOBAL_REQUESTS=1000
ENV RATE_LIMIT_IP_TOKENS=10000
ENV RATE_LIMIT_GLOBAL_TOKENS=100000
ENV RATE_LIMIT_WINDOW=3600
ENV AI_PROVIDER=openai

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
