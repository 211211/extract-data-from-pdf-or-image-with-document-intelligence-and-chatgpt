# Langfuse Setup Guide (Self-Hosted MIT Version)

This guide covers setting up Langfuse for LLM observability in the AINativeEnterpriseChatApp.

## What is Langfuse?

Langfuse is an open-source LLM engineering platform that provides:
- **Tracing**: Track LLM calls, inputs, outputs, and latency
- **Analytics**: Token usage, costs, and performance metrics
- **Debugging**: Inspect individual traces and generations
- **Scoring**: Add quality scores and user feedback
- **Datasets**: Create test datasets from production data

## Quick Start with Docker Compose

### 1. Create docker-compose.langfuse.yml

```yaml
version: '3.8'

services:
  langfuse-server:
    image: langfuse/langfuse:2
    container_name: langfuse
    depends_on:
      langfuse-db:
        condition: service_healthy
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@langfuse-db:5432/langfuse
      - NEXTAUTH_SECRET=mysecret
      - SALT=mysalt
      - NEXTAUTH_URL=http://localhost:3000
      - TELEMETRY_ENABLED=${TELEMETRY_ENABLED:-true}
      - LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES=${LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES:-false}
    restart: unless-stopped

  langfuse-db:
    image: postgres:15-alpine
    container_name: langfuse-db
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=langfuse
    ports:
      - "5433:5432"
    volumes:
      - langfuse_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  langfuse_postgres_data:
```

### 2. Start Langfuse

```bash
docker-compose -f docker-compose.langfuse.yml up -d
```

### 3. Access Langfuse UI

Open http://localhost:3000 in your browser.

1. Create an account (first user becomes admin)
2. Create a new project
3. Go to **Settings > API Keys**
4. Create a new API key pair (Public Key + Secret Key)

### 4. Configure the Application

Add to your `.env` file:

```env
# Langfuse Configuration
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
LANGFUSE_BASE_URL=http://localhost:3000
```

### 5. Start the Application

```bash
yarn start:dev
```

## What Gets Traced

The integration automatically traces:

### Chat Conversations (NormalAgent)
- **Trace**: Full conversation with user ID, session ID
- **Generation**: LLM call with model, parameters, input/output, token usage
- **Tags**: `normal-agent`, `chat`

### RAG Workflows (RAGAgent)
- **Trace**: Full RAG workflow
- **Span**: Document search operation (query, results)
- **Generation**: LLM call with context
- **Tags**: `rag-agent`, `retrieval`, `chat`

## Viewing Traces

1. Open Langfuse UI at http://localhost:3000
2. Navigate to **Traces**
3. Click on a trace to see:
   - Input messages
   - Output response
   - Token usage
   - Latency breakdown
   - Nested spans and generations

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐         ┌──────────────────────────────┐  │
│  │   Chat Service  │────────▶│      LangfuseService         │  │
│  └────────┬────────┘         │  - createTrace()             │  │
│           │                  │  - createGeneration()        │  │
│           ▼                  │  - createSpan()              │  │
│  ┌─────────────────┐         │  - updateTrace()             │  │
│  │   NormalAgent   │────────▶│  - scoreTrace()              │  │
│  │   RAGAgent      │         └────────────┬─────────────────┘  │
│  │   etc.          │                      │                    │
│  └─────────────────┘                      │                    │
│                                           ▼                    │
└───────────────────────────────────────────┼────────────────────┘
                                            │
                                    Async batched events
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Langfuse Server                              │
│                   (Self-Hosted MIT)                              │
├─────────────────────────────────────────────────────────────────┤
│  - Trace ingestion                                               │
│  - Analytics dashboard                                           │
│  - Cost calculation                                              │
│  - User feedback                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## API Reference

### LangfuseService Methods

```typescript
// Create a trace (conversation/request)
createTrace(traceId: string, name: string, options?: {
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  input?: unknown;
}): Trace | null;

// Track an LLM generation
createGeneration(traceId: string, params: {
  name: string;
  model: string;
  modelParameters?: Record<string, unknown>;
  input: unknown;
  metadata?: Record<string, unknown>;
}): Generation | null;

// Track a generic operation
createSpan(traceId: string, params: {
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}): Span | null;

// Update trace with output
updateTrace(traceId: string, update: {
  output?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
}): void;

// Add quality score
scoreTrace(traceId: string, name: string, value: number, comment?: string): void;

// Helper: Start generation with auto-timing
startGeneration(traceId: string, params: GenerationParams): {
  generation: Generation;
  end: (update: GenerationUpdate) => void;
};

// Helper: Start span with auto-timing
startSpan(traceId: string, params: SpanParams): {
  span: Span;
  end: (update: { output?: unknown }) => void;
};
```

## Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `LANGFUSE_ENABLED` | Enable/disable Langfuse | `true` if keys set |
| `LANGFUSE_PUBLIC_KEY` | Public API key | Required |
| `LANGFUSE_SECRET_KEY` | Secret API key | Required |
| `LANGFUSE_BASE_URL` | Langfuse server URL | `http://localhost:3000` |
| `LANGFUSE_FLUSH_AT` | Batch size before flush | `15` |
| `LANGFUSE_FLUSH_INTERVAL` | Flush interval (ms) | `10000` |

## Production Deployment

For production, consider:

### 1. Dedicated Infrastructure

```yaml
# Production docker-compose
services:
  langfuse-server:
    image: langfuse/langfuse:2
    environment:
      - DATABASE_URL=postgresql://user:pass@db-host:5432/langfuse
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}  # Use strong secret
      - SALT=${SALT}                        # Use strong salt
      - NEXTAUTH_URL=https://langfuse.yourdomain.com
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 2G
```

### 2. Security

- Use HTTPS with valid certificates
- Set strong `NEXTAUTH_SECRET` and `SALT`
- Restrict network access to Langfuse
- Use separate database credentials

### 3. High Availability

- Use managed PostgreSQL (RDS, Cloud SQL)
- Deploy multiple Langfuse replicas
- Use Redis for session storage (optional)

## Troubleshooting

### Langfuse not receiving traces

1. Check credentials in `.env`
2. Verify Langfuse server is running: `curl http://localhost:3000/api/health`
3. Check application logs for Langfuse errors
4. Ensure `LANGFUSE_ENABLED=true`

### High memory usage

Reduce batch size and flush interval:
```env
LANGFUSE_FLUSH_AT=5
LANGFUSE_FLUSH_INTERVAL=5000
```

### Database connection issues

```bash
# Check PostgreSQL logs
docker logs langfuse-db

# Verify connection
docker exec langfuse-db pg_isready -U postgres
```

## References

- [Langfuse Documentation](https://langfuse.com/docs)
- [Self-Hosting Guide](https://langfuse.com/docs/deployment/self-host)
- [TypeScript SDK](https://langfuse.com/docs/sdk/typescript)
- [MIT License](https://github.com/langfuse/langfuse/blob/main/LICENSE)
