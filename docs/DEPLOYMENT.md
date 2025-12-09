# Deployment Guide

Complete guide for deploying the AINativeEnterpriseChatApp - an enterprise chat application with RAG, streaming, and multi-agent orchestration.

## Table of Contents

1. [Local Development](#local-development)
2. [Docker Deployment](#docker-deployment)
3. [Kubernetes Deployment](#kubernetes-deployment)
4. [Azure App Service](#azure-app-service)
5. [Environment Configuration](#environment-configuration)
6. [Scaling Strategies](#scaling-strategies)
7. [Monitoring & Observability](#monitoring--observability)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)

---

## Local Development

### Prerequisites

- Node.js 18+ (LTS recommended)
- Yarn package manager
- Azure subscription with configured services

### Setup

```bash
# Clone repository
git clone https://github.com/211211/extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt.git
cd extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt

# Install dependencies
yarn install

# Copy environment template
cp .env.example .env

# Edit .env with your Azure credentials
nano .env

# Start development server
yarn start:dev
```

### Development Commands

```bash
# Start with hot reload
yarn start:dev

# Start in debug mode
yarn start:debug

# Run tests
yarn test

# Run tests with coverage
yarn test:cov

# Run E2E tests
yarn test:e2e

# Lint code
yarn lint

# Format code
yarn format

# Build for production
yarn build
```

### Verify Installation

```bash
# Health check
curl http://localhost:8083/

# Swagger docs
open http://localhost:8083/swaggers
```

---

## Docker Deployment

### Dockerfile

Create `Dockerfile` in project root:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source and build
COPY . .
RUN yarn build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Copy built application
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

USER nestjs

# Expose port
EXPOSE 8083

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8083/ || exit 1

# Start application
CMD ["node", "dist/main.js"]
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      target: production
    ports:
      - "8083:8083"
    environment:
      - NODE_ENV=production
      - APP_PORT=8083
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:8083/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  # Optional: Redis for caching (future feature)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

### Docker Commands

```bash
# Build image
docker build -t doc-intelligence-api .

# Run container
docker run -d \
  --name doc-intelligence \
  -p 8083:8083 \
  --env-file .env \
  doc-intelligence-api

# View logs
docker logs -f doc-intelligence

# Stop container
docker stop doc-intelligence

# Using Docker Compose
docker-compose up -d
docker-compose logs -f
docker-compose down
```

### Multi-Stage Build Optimization

```dockerfile
# Optimized Dockerfile with smaller image size
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

USER nestjs

EXPOSE 8083

CMD ["node", "dist/main.js"]
```

---

## Kubernetes Deployment

### Namespace

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: doc-intelligence
```

### ConfigMap

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: doc-intelligence-config
  namespace: doc-intelligence
data:
  APP_PORT: "8083"
  APP_BASE_PATH: "/api/v1"
  NODE_ENV: "production"
```

### Secret

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: doc-intelligence-secrets
  namespace: doc-intelligence
type: Opaque
stringData:
  AZURE_DOCUMENT_INTELLIGENCE_KEY: "your-key"
  AZURE_OPENAI_API_KEY: "your-key"
  AZURE_SEARCH_API_KEY: "your-key"
  AZURE_AI_FOUNDRY_API_KEY: "your-key"
```

### Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: doc-intelligence-api
  namespace: doc-intelligence
  labels:
    app: doc-intelligence-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: doc-intelligence-api
  template:
    metadata:
      labels:
        app: doc-intelligence-api
    spec:
      containers:
        - name: api
          image: your-registry/doc-intelligence-api:latest
          ports:
            - containerPort: 8083
          envFrom:
            - configMapRef:
                name: doc-intelligence-config
            - secretRef:
                name: doc-intelligence-secrets
          env:
            - name: AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
              value: "https://your-resource.cognitiveservices.azure.com/"
            - name: AZURE_OPENAI_API_INSTANCE_NAME
              value: "your-instance"
            - name: AZURE_SEARCH_NAME
              value: "your-search-service"
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /
              port: 8083
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /
              port: 8083
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          securityContext:
            runAsNonRoot: true
            runAsUser: 1001
            readOnlyRootFilesystem: true
```

### Service

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: doc-intelligence-api
  namespace: doc-intelligence
spec:
  selector:
    app: doc-intelligence-api
  ports:
    - port: 80
      targetPort: 8083
  type: ClusterIP
```

### Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: doc-intelligence-ingress
  namespace: doc-intelligence
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
spec:
  tls:
    - hosts:
        - api.yourdomain.com
      secretName: doc-intelligence-tls
  rules:
    - host: api.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: doc-intelligence-api
                port:
                  number: 80
```

### Horizontal Pod Autoscaler

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: doc-intelligence-hpa
  namespace: doc-intelligence
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: doc-intelligence-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Create ConfigMap and Secrets
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml

# Deploy application
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Check status
kubectl get pods -n doc-intelligence
kubectl get svc -n doc-intelligence
kubectl get ingress -n doc-intelligence

# View logs
kubectl logs -f deployment/doc-intelligence-api -n doc-intelligence
```

---

## Azure App Service

### Using Azure CLI

```bash
# Login to Azure
az login

# Create resource group
az group create --name doc-intelligence-rg --location eastus

# Create App Service Plan
az appservice plan create \
  --name doc-intelligence-plan \
  --resource-group doc-intelligence-rg \
  --sku P1V2 \
  --is-linux

# Create Web App
az webapp create \
  --name doc-intelligence-api \
  --resource-group doc-intelligence-rg \
  --plan doc-intelligence-plan \
  --runtime "NODE:20-lts"

# Configure environment variables
az webapp config appsettings set \
  --name doc-intelligence-api \
  --resource-group doc-intelligence-rg \
  --settings \
    APP_PORT=8080 \
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com/" \
    AZURE_DOCUMENT_INTELLIGENCE_KEY="@Microsoft.KeyVault(SecretUri=https://your-vault.vault.azure.net/secrets/doc-intel-key)"

# Deploy from container
az webapp config container set \
  --name doc-intelligence-api \
  --resource-group doc-intelligence-rg \
  --docker-custom-image-name your-registry/doc-intelligence-api:latest \
  --docker-registry-server-url https://your-registry.azurecr.io
```

### Azure DevOps Pipeline

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - development

pool:
  vmImage: 'ubuntu-latest'

variables:
  containerRegistry: 'your-registry.azurecr.io'
  imageName: 'doc-intelligence-api'
  tag: '$(Build.BuildId)'

stages:
  - stage: Build
    jobs:
      - job: BuildAndPush
        steps:
          - task: Docker@2
            inputs:
              containerRegistry: 'ACR-Connection'
              repository: '$(imageName)'
              command: 'buildAndPush'
              Dockerfile: '**/Dockerfile'
              tags: |
                $(tag)
                latest

  - stage: Deploy_Dev
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/development')
    jobs:
      - deployment: DeployToDev
        environment: 'development'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebAppContainer@1
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    appName: 'doc-intelligence-api-dev'
                    containers: '$(containerRegistry)/$(imageName):$(tag)'

  - stage: Deploy_Prod
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - deployment: DeployToProd
        environment: 'production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebAppContainer@1
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    appName: 'doc-intelligence-api-prod'
                    containers: '$(containerRegistry)/$(imageName):$(tag)'
                    deployToSlotOrASE: true
                    slotName: 'staging'
                - task: AzureAppServiceManage@0
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    Action: 'Swap Slots'
                    WebAppName: 'doc-intelligence-api-prod'
                    SourceSlot: 'staging'
```

---

## Environment Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `APP_PORT` | Server port | `8083` |
| `APP_BASE_PATH` | API prefix | `/api/v1` |
| `NODE_ENV` | Environment | `production` |

### Azure Document Intelligence

| Variable | Description |
|----------|-------------|
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Doc Intel endpoint URL |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Doc Intel API key |
| `AZURE_DOCUMENT_INTELLIGENCE_API_VERSION` | API version (e.g., `2024-11-30`) |

### Azure OpenAI

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_API_INSTANCE_NAME` | Azure OpenAI instance name |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_API_VERSION` | API version |
| `AZURE_OPENAI_API_DEPLOYMENT_NAME` | Model deployment name |
| `AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME` | Embeddings deployment |

### Azure AI Foundry (Grok)

| Variable | Description |
|----------|-------------|
| `AZURE_AI_FOUNDRY_BASE_URL` | AI Foundry endpoint |
| `AZURE_AI_FOUNDRY_API_KEY` | AI Foundry API key |
| `AZURE_AI_FOUNDRY_MODEL_NAME` | Model name (e.g., `grok-3-mini`) |

### Azure Cognitive Search

| Variable | Description |
|----------|-------------|
| `AZURE_SEARCH_NAME` | Search service name |
| `AZURE_SEARCH_API_KEY` | Search API key |
| `AZURE_SEARCH_INDEX_NAME` | Index name |
| `AZURE_SEARCH_API_VERSION` | API version |

### Database Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_PROVIDER` | Provider: `memory`, `sqlite`, `cosmosdb` | No (default: `memory`) |
| `DATABASE_SQLITE_PATH` | SQLite file path | If sqlite |
| `DATABASE_MEMORY_TTL_MS` | Memory store TTL (0 = no expiry) | No |
| `AZURE_COSMOSDB_ENDPOINT` | CosmosDB endpoint | If cosmosdb |
| `AZURE_COSMOSDB_KEY` | CosmosDB key | If cosmosdb |
| `AZURE_COSMOSDB_DATABASE` | Database name (auto-created) | If cosmosdb |
| `AZURE_COSMOSDB_CONTAINER` | Container name (auto-created) | If cosmosdb |

### Streaming Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `SSE_STREAM_STORE_PROVIDER` | Provider: `memory`, `redis` | No (default: `memory`) |
| `REDIS_URL` | Redis connection URL | If redis |

### Complete .env.example

```env
# Application
APP_NAME=extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt
APP_VERSION=1.0.0
APP_HOST=0.0.0.0
APP_PORT=8083
APP_BASE_PATH=/api/v1
NODE_ENV=development

# OpenAI (Standard - optional)
OPENAI_API_KEY=

# Azure OpenAI (Responses API)
AZURE_OPENAI_API_INSTANCE_NAME=your-instance
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-5.1
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME=text-embedding-3-large

# Azure AI Foundry - Grok
AZURE_AI_FOUNDRY_BASE_URL=https://your-resource.services.ai.azure.com/models
AZURE_AI_FOUNDRY_API_VERSION=2024-05-01-preview
AZURE_AI_FOUNDRY_API_KEY=your-key
AZURE_AI_FOUNDRY_MODEL_NAME=grok-3-mini

# Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your-key
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30

# Azure Search
AZURE_SEARCH_API_KEY=your-key
AZURE_SEARCH_NAME=your-search-service
AZURE_SEARCH_INDEX_NAME=your-index
AZURE_SEARCH_API_VERSION=2025-05-01-preview

# ============================================================================
# Database Configuration
# ============================================================================

# Database Provider: 'memory' (dev), 'sqlite' (standalone), 'cosmosdb' (production)
DATABASE_PROVIDER=cosmosdb

# SQLite Configuration (required if DATABASE_PROVIDER=sqlite)
DATABASE_SQLITE_PATH=./data/chat.db

# Memory store TTL in milliseconds (optional, 0 = no expiry)
DATABASE_MEMORY_TTL_MS=0

# Azure CosmosDB Configuration (required if DATABASE_PROVIDER=cosmosdb)
AZURE_COSMOSDB_ENDPOINT=https://your-account.documents.azure.com:443/
AZURE_COSMOSDB_KEY=your-key
AZURE_COSMOSDB_DATABASE=chatdb
AZURE_COSMOSDB_CONTAINER=chat

# ============================================================================
# Streaming Configuration
# ============================================================================

# Stream Store Provider: 'memory' (single instance), 'redis' (distributed)
SSE_STREAM_STORE_PROVIDER=memory

# Redis Configuration (required if SSE_STREAM_STORE_PROVIDER=redis)
REDIS_URL=redis://localhost:6379

# ============================================================================
# Observability (optional)
# ============================================================================
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
```

---

## Scaling Strategies

### Horizontal Scaling

```yaml
# Increase replicas for more capacity
spec:
  replicas: 5
```

### Vertical Scaling

```yaml
# Increase resources per pod
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

### Worker Sharding for Batch Processing

```yaml
# Multiple worker deployments with sharding
apiVersion: apps/v1
kind: Deployment
metadata:
  name: doc-intelligence-worker-0
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: worker
          env:
            - name: SHARD_INDEX
              value: "0"
            - name: TOTAL_WORKERS
              value: "4"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: doc-intelligence-worker-1
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: worker
          env:
            - name: SHARD_INDEX
              value: "1"
            - name: TOTAL_WORKERS
              value: "4"
```

---

## Monitoring & Observability

### Health Endpoints

Add to your application:

```typescript
// src/health/health.controller.ts
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  ready() {
    // Check dependencies
    return { status: 'ready' };
  }

  @Get('live')
  live() {
    return { status: 'alive' };
  }
}
```

### Prometheus Metrics

```typescript
// Add prom-client for metrics
import { collectDefaultMetrics, Counter, Histogram } from 'prom-client';

collectDefaultMetrics();

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
});

export const extractionCounter = new Counter({
  name: 'document_extractions_total',
  help: 'Total number of document extractions',
  labelNames: ['status', 'type'],
});
```

### Logging Configuration

```typescript
// Structured JSON logging
import { Logger } from '@nestjs/common';

const logger = new Logger('App');

logger.log({
  message: 'Request processed',
  requestId: 'abc-123',
  duration: 150,
  status: 'success',
});
```

---

## Security Considerations

### 1. API Authentication

Implement Bearer token authentication:

```typescript
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new UnauthorizedException();
    }

    // Validate token
    return this.validateToken(token);
  }
}
```

### 2. Rate Limiting

```typescript
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
    }),
  ],
})
export class AppModule {}
```

### 3. Input Validation

Always validate file uploads:

```typescript
@Post('extract')
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Invalid file type'), false);
    }
  },
}))
async extract(@UploadedFile() file: Express.Multer.File) {}
```

### 4. Secrets Management

Use Azure Key Vault:

```bash
# Reference secrets in App Service
AZURE_OPENAI_API_KEY=@Microsoft.KeyVault(SecretUri=https://your-vault.vault.azure.net/secrets/openai-key)
```

---

## Troubleshooting

### Common Issues

**1. Container won't start**
```bash
# Check logs
docker logs doc-intelligence

# Common fix: memory limit
docker run -m 1g doc-intelligence-api
```

**2. Azure API rate limits**
```
Error: 429 Too Many Requests
```
Solution: Implement retry with exponential backoff.

**3. Large file uploads failing**
```
Error: 413 Payload Too Large
```
Solution: Configure nginx/ingress proxy body size:
```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "50m"
```

**4. SSL/TLS errors**
```
Error: unable to verify the first certificate
```
Solution: Set `NODE_TLS_REJECT_UNAUTHORIZED=0` for development only.

### Debug Mode

```bash
# Enable debug logging
NODE_ENV=development DEBUG=* yarn start:dev
```

### Performance Testing

```bash
# Load testing with k6
k6 run --vus 10 --duration 30s load-test.js
```

```javascript
// load-test.js
import http from 'k6/http';
import { check } from 'k6';

export default function() {
  const res = http.get('http://localhost:8083/api/v1/search/semantic?query=test');
  check(res, { 'status is 200': (r) => r.status === 200 });
}
```
