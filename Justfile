# Hathor Playground - Common Development Tasks

# Default recipe to display help
default:
    @just --list

# Install all dependencies (Node.js and Python)
install:
    @echo "📦 Installing dependencies..."
    @cd backend && poetry install
    @cd frontend && npm install
    @echo "✓ Dependencies installed"

# Start both development servers (requires 2 terminals - use dev-backend or dev-frontend separately)
dev:
    @echo "🚀 To start development:"
    @echo "  Terminal 1: just dev-backend"
    @echo "  Terminal 2: just dev-frontend"
    @echo ""
    @echo "Or run them individually as needed"

# Start backend development server
dev-backend:
    @echo "🚀 Starting backend server..."
    cd backend && poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Start frontend development server
dev-frontend:
    @echo "🚀 Starting frontend server..."
    cd frontend && npm run dev

# Run all tests
test:
    @echo "🧪 Running tests..."
    @echo "Testing backend..."
    @cd backend && poetry run pytest
    @echo "Testing frontend..."
    @cd frontend && npm run type-check

# Format code (JavaScript/TypeScript and Python)
fmt:
    @echo "✨ Formatting code..."
    @echo "Formatting Python..."
    @cd backend && ruff format .
    @echo "Formatting frontend..."
    @cd frontend && npm run lint || true
    @echo "✓ Code formatted"

# Lint code
lint:
    @echo "🔍 Linting code..."
    @echo "Linting Python..."
    @cd backend && ruff check .
    @echo "Linting frontend..."
    @cd frontend && npm run lint || true

# Clean build artifacts and caches
clean:
    @echo "🧹 Cleaning build artifacts..."
    @rm -rf backend/__pycache__
    @rm -rf backend/.pytest_cache
    @rm -rf backend/.ruff_cache
    @rm -rf frontend/.next
    @rm -rf frontend/node_modules/.cache
    @find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    @find . -type f -name "*.pyc" -delete 2>/dev/null || true
    @echo "✓ Cleaned"

# Start Redis server manually
redis:
    @echo "🔴 Starting Redis server on port 6379..."
    @echo "Press Ctrl+C to stop"
    redis-server

# Show environment information
info:
    @echo "📊 Environment Information:"
    @echo "  Node.js:    $(node --version)"
    @echo "  npm:        $(npm --version)"
    @echo "  Python:     $(python3 --version)"
    @echo "  Poetry:     $(poetry --version)"
    @echo "  Redis:      $(redis-cli --version)"
    @echo "  PostgreSQL: $(psql --version)"
