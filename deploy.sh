#!/bin/bash

# Deployment script for Nano Contracts IDE
# Builds Docker images and deploys to production server

set -e  # Exit on error

# Configuration
REMOTE_USER="yan.martins"
REMOTE_HOST="34.57.25.205"
REMOTE_PATH="~/"
PROJECT_NAME="nano-contracts-ide"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_warning ".env file not found. Creating from example..."
    cp .env.example .env
    print_warning "Please edit .env file with your configuration and run the script again."
    exit 1
fi

# Check if OpenAI API key is configured
if grep -q "your_openai_api_key_here" .env; then
    print_error "OpenAI API key not configured in .env file!"
    print_warning "Please edit .env file and replace 'your_openai_api_key_here' with your actual API key."
    print_warning "You can get an API key from: https://platform.openai.com/api-keys"
    print_warning ""
    print_warning "If you don't have an API key, the AI Assistant feature will not work."
    read -p "Do you want to continue without AI Assistant? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

print_status "Starting deployment process..."

# Step 1: Build Docker images with platform specification
print_status "Building Docker images for linux/amd64 platform..."

# Build backend image (from parent directory to access hathor package)
print_status "Building backend image..."
docker build --platform linux/amd64 -f backend/Dockerfile -t ${PROJECT_NAME}-backend:${TIMESTAMP} -t ${PROJECT_NAME}-backend:latest ..

# Build frontend image
print_status "Building frontend image..."
docker build --platform linux/amd64 -t ${PROJECT_NAME}-frontend:${TIMESTAMP} -t ${PROJECT_NAME}-frontend:latest ./frontend

# Step 2: Save Docker images to tar files
print_status "Saving Docker images..."

docker save ${PROJECT_NAME}-backend:latest -o ${PROJECT_NAME}-backend.tar
docker save ${PROJECT_NAME}-frontend:latest -o ${PROJECT_NAME}-frontend.tar

# Compress the images
print_status "Compressing images..."
gzip -f ${PROJECT_NAME}-backend.tar
gzip -f ${PROJECT_NAME}-frontend.tar

# Step 3: Create deployment package
print_status "Creating deployment package..."

# Create temporary deployment directory
DEPLOY_DIR="deploy_${TIMESTAMP}"
mkdir -p ${DEPLOY_DIR}

# Copy necessary files
cp ${PROJECT_NAME}-backend.tar.gz ${DEPLOY_DIR}/
cp ${PROJECT_NAME}-frontend.tar.gz ${DEPLOY_DIR}/
# cp docker-compose.yml ${DEPLOY_DIR}/
cp .env ${DEPLOY_DIR}/
cp -r letsencrypt ${DEPLOY_DIR}/ 2>/dev/null || true  # Copy if exists

# Copy nginx config for frontend
mkdir -p ${DEPLOY_DIR}/frontend
cp frontend/nginx.conf ${DEPLOY_DIR}/frontend/

# Create remote setup script
cat > ${DEPLOY_DIR}/setup.sh << 'EOF'
#!/bin/bash

# Remote setup script
set -e

PROJECT_NAME="nano-contracts-ide"

echo "Setting up Nano Contracts IDE on remote server..."

# Load Docker images
echo "Loading Docker images..."
gunzip -c ${PROJECT_NAME}-backend.tar.gz | docker load
gunzip -c ${PROJECT_NAME}-frontend.tar.gz | docker load

# Tag images for docker-compose
docker tag ${PROJECT_NAME}-backend:latest ${PROJECT_NAME}_backend:latest
docker tag ${PROJECT_NAME}-frontend:latest ${PROJECT_NAME}_frontend:latest

# Create letsencrypt directory if it doesn't exist
mkdir -p letsencrypt

# Stop existing containers if running
echo "Stopping existing containers..."
docker-compose down || true

# Start services
echo "Starting services..."
docker-compose up -d

# Show status
echo "Checking service status..."
docker-compose ps

echo "Deployment complete!"
echo "Frontend: https://playground2.hathor.dev"
echo "API: https://playground2.hathor.dev/api"
echo "Traefik Dashboard: https://traefik.playground2.hathor.dev"
EOF

chmod +x ${DEPLOY_DIR}/setup.sh

# Step 4: Transfer files to remote server
print_status "Transferring files to remote server..."

# Create remote directory
ssh ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p ${REMOTE_PATH}/${PROJECT_NAME}"

# Transfer deployment package
scp -r ${DEPLOY_DIR}/* ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/${PROJECT_NAME}/

# Step 5: Execute remote setup
print_status "Executing remote setup..."

ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH}/${PROJECT_NAME} && bash setup.sh"

# Step 6: Cleanup local files
print_status "Cleaning up local files..."
rm -f ${PROJECT_NAME}-backend.tar.gz
rm -f ${PROJECT_NAME}-frontend.tar.gz
rm -rf ${DEPLOY_DIR}

print_status "Deployment completed successfully!"
print_status "Access your application at:"
echo "  - Frontend: https://playground2.hathor.dev"
echo "  - API: https://playground2.hathor.dev/api"
echo "  - Traefik Dashboard: https://traefik.playground2.hathor.dev"

# Optional: Show remote logs
read -p "Do you want to view the remote logs? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH}/${PROJECT_NAME} && docker-compose logs --tail=100 -f"
fi
