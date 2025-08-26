# Production Deployment Guide

This guide explains how to deploy the Nano Contracts IDE to production using Docker Compose with Traefik and Let's Encrypt SSL certificates.

## Prerequisites

1. **Server Setup**:
   - Ubuntu/Debian server with Docker and Docker Compose installed
   - Domain `playground2.hathor.dev` pointing to your server's IP
   - Ports 80 and 443 open in firewall
   - At least 2GB RAM and 2 CPU cores recommended

2. **DNS Configuration**:
   - `playground2.hathor.dev` → Your server IP
   - `traefik.playground2.hathor.dev` → Your server IP (for Traefik dashboard)

## Deployment Steps

### 1. Clone and Prepare

```bash
# Clone the repository
git clone <repository-url>
cd nano-contracts-ide

# Create environment file
cp .env.example .env
```

### 2. Configure Environment

Edit the `.env` file:

```bash
# Required: OpenAI API Key for AI Assistant
OPENAI_API_KEY=your_actual_openai_api_key

# Optional: Update email for Let's Encrypt
ACME_EMAIL=your-email@domain.com

# Optional: Change Traefik dashboard password
TRAEFIK_AUTH=admin:$$2y$$10$$NewHashedPasswordHere
```

### 3. Deploy

```bash
# Build and start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Verify Deployment

1. **Frontend**: Visit https://playground2.hathor.dev
2. **API**: Check https://playground2.hathor.dev/api/health
3. **Traefik Dashboard**: Visit https://traefik.playground2.hathor.dev (login: admin/admin123)

## Services

### Frontend
- **URL**: https://playground2.hathor.dev
- **Container**: `nano-contracts-frontend`
- **Technology**: Next.js served by Nginx
- **Port**: 8080 (internal)

### Backend
- **URL**: https://playground2.hathor.dev/api
- **Container**: `nano-contracts-backend`
- **Technology**: FastAPI with Uvicorn
- **Port**: 8000 (internal)

### Traefik
- **Dashboard**: https://traefik.playground2.hathor.dev
- **Container**: `traefik`
- **Technology**: Traefik v3.0
- **Ports**: 80, 443, 8080

### Redis (Optional)
- **Container**: `redis`
- **Technology**: Redis 7 Alpine
- **Port**: 6379 (internal only)

## SSL Certificates

- **Provider**: Let's Encrypt
- **Challenge**: TLS Challenge
- **Auto-renewal**: Handled by Traefik
- **Storage**: `./letsencrypt/acme.json`

## Security Features

1. **HTTPS Redirect**: All HTTP traffic redirected to HTTPS
2. **Security Headers**: HSTS, XSS Protection, Content-Type Options
3. **Non-root Users**: All containers run as non-root users
4. **Private Network**: Services communicate via Docker network
5. **Health Checks**: All services have health monitoring

## Maintenance

### Update Services

```bash
# Pull latest images and restart
docker-compose pull
docker-compose up -d

# View updated service status
docker-compose ps
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f frontend
docker-compose logs -f backend
docker-compose logs -f traefik
```

### Backup Let's Encrypt Certificates

```bash
# Backup certificates
cp letsencrypt/acme.json ~/backups/acme-$(date +%Y%m%d).json

# Restore certificates
cp ~/backups/acme-20231201.json letsencrypt/acme.json
docker-compose restart traefik
```

### Scale Services

```bash
# Scale backend to 2 instances
docker-compose up -d --scale backend=2

# Scale frontend to 2 instances  
docker-compose up -d --scale frontend=2
```

## Monitoring

### Health Checks

- **Frontend**: `curl https://playground2.hathor.dev/health`
- **Backend**: `curl https://playground2.hathor.dev/api/health`
- **Traefik**: Check dashboard at https://traefik.playground2.hathor.dev

### Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df

# Clean up unused resources
docker system prune -f
```

## Troubleshooting

### SSL Certificate Issues

```bash
# Check certificate status
docker-compose logs traefik | grep letsencrypt

# Force certificate renewal
docker-compose stop traefik
rm letsencrypt/acme.json
docker-compose up -d traefik
```

### Service Connection Issues

```bash
# Check service logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart specific service
docker-compose restart backend

# Rebuild and restart
docker-compose up -d --build backend
```

### Performance Issues

```bash
# Check resource usage
docker stats

# Check disk space
df -h
docker system df

# Clean up
docker system prune -f
docker volume prune -f
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for AI assistant | Required |
| `ACME_EMAIL` | Email for Let's Encrypt registration | admin@hathor.network |
| `DOMAIN` | Main application domain | playground2.hathor.dev |
| `TRAEFIK_AUTH` | Traefik dashboard auth (bcrypt) | admin:admin123 |
| `ENVIRONMENT` | Application environment | production |

## Support

For issues and questions:
1. Check the logs: `docker-compose logs -f`
2. Verify DNS configuration
3. Ensure ports 80/443 are accessible
4. Check disk space and resources
5. Review Traefik dashboard for routing issues
