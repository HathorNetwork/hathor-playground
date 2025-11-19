# Hathor Playground - Common Development Tasks

# Default recipe to display help
default:
    @just --list

# Install dependencies
install:
    @echo "📦 Installing dependencies..."
    @cd frontend && npm install
    @echo "✓ Dependencies installed"

# Start development server
dev:
    @echo "🚀 Starting frontend server..."
    cd frontend && npm run dev

# Run tests
test:
    @echo "🧪 Running tests..."
    @cd frontend && npm run type-check

# Format code
fmt:
    @echo "✨ Formatting code..."
    @cd frontend && npm run lint || true
    @echo "✓ Code formatted"

# Lint code
lint:
    @echo "🔍 Linting code..."
    @cd frontend && npm run lint || true

# Clean build artifacts and caches
clean:
    @echo "🧹 Cleaning build artifacts..."
    @rm -rf frontend/.next
    @rm -rf frontend/node_modules/.cache
    @echo "✓ Cleaned"

# Start Redis server manually
redis:
    @echo "🔴 Starting Redis server on port 6379..."
    @echo "Press Ctrl+C to stop"
    redis-server

# Documentation
docs:
    @echo "📚 Serving documentation..."
    mkdocs serve

docs-build:
    @echo "📚 Building documentation..."
    mkdocs build

# Show environment information
info:
    @echo "📊 Environment Information:"
    @echo "  Node.js:    $(node --version)"
    @echo "  npm:        $(npm --version)"
    @echo "  Redis:      $(redis-cli --version)"
    @echo "  PostgreSQL: $(psql --version)"
