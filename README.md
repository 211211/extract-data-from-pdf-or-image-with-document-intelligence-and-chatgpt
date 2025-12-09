# AINativeEnterpriseChatApp

A production-ready **Enterprise ChatGPT-like Application** built with NestJS and Azure AI services. Features RAG (Retrieval-Augmented Generation), SSE streaming, multi-agent orchestration, and enterprise-grade patterns (optimistic concurrency, soft deletes, user isolation).

## Features

- **Streaming Chat** - Real-time SSE streaming with Azure OpenAI (GPT-5.1) using Responses API
- **Multi-Agent System** - Pluggable agents (Normal, RAG, Multi-Agent orchestrator with Planner/Researcher/Writer)
- **Chat with Documents** - Upload PDFs/images, ask questions, get AI-powered answers
- **RAG Architecture** - Vector + Semantic + Hybrid search with Azure Cognitive Search
- **Multi-turn Conversations** - Thread management with persistent chat history
- **Pluggable Database** - Repository pattern with Memory/SQLite/CosmosDB implementations
- **Enterprise Security** - User isolation, ownership guards, optimistic concurrency (ETags)
- **Production Observability** - Structured logging with trace IDs, Prometheus metrics
- **LLM Observability** - Langfuse integration (self-hosted MIT) for traces, generations, token usage
- **Infrastructure as Code** - Complete Terraform setup for Azure deployment
- **Multi-Provider LLM** - Flexible LLM backend (Azure OpenAI, local Ollama, Mock for testing)
- **Document Conversion** - MarkItDown for Office docs (DOCX, XLSX, PPTX), Azure Document Intelligence for complex PDFs
- **Smart Chunking** - Header-aware Markdown chunking with metadata preservation for RAG

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     AINativeEnterpriseChatApp                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │   Upload    │  │ Pre-Indexed │  │   Custom    │  │  Multi-Turn │   │
│  │   Files     │  │   Data      │  │   Agents    │  │    Chat     │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │                │           │
│         ▼                ▼                ▼                ▼           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                 DATA PROCESSING LAYER                            │   │
│  │  • Azure Document Intelligence (PDF/Image extraction)            │   │
│  │  • Text chunking & embedding generation (3072-dim)               │   │
│  │  • Vector indexing with Azure Cognitive Search                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    AGENT LAYER                                   │   │
│  │  • Normal Agent - Direct LLM completion                          │   │
│  │  • RAG Agent - Retrieval-augmented generation                    │   │
│  │  • Multi-Agent Orchestrator (Planner → Researcher → Writer)      │   │
│  │  • Extensible agent framework with factory pattern               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    PERSISTENCE LAYER                             │   │
│  │  • Repository pattern (IChatRepository interface)                │   │
│  │  • Memory (dev), SQLite (standalone), CosmosDB (production)      │   │
│  │  • Optimistic concurrency with ETags                             │   │
│  │  • Soft deletes with restore capability                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    STREAMING LAYER                               │   │
│  │  • Server-Sent Events (SSE) with RFC 6202 compliance             │   │
│  │  • Stream abort (memory or Redis for distributed)                │   │
│  │  • User isolation & ownership validation                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Category | Technologies |
|----------|--------------|
| **Backend** | NestJS, TypeScript, Node.js 20 |
| **AI/ML** | Azure OpenAI (GPT-5.1), Grok-3-mini, Embeddings (3072-dim), RAG |
| **Search** | Azure Cognitive Search (Vector, Semantic, Hybrid with HNSW) |
| **Document Processing** | Azure Document Intelligence (prebuilt-read, prebuilt-layout) |
| **Database** | Azure CosmosDB (prod), SQLite (standalone), In-Memory (dev) |
| **Streaming** | SSE with optional Redis for distributed abort |
| **LLM Observability** | Langfuse (self-hosted MIT) - traces, generations, token usage |
| **Cloud** | Azure App Service, Key Vault, Blob Storage |
| **DevOps** | Terraform, Multi-environment CI/CD |
| **Observability** | Structured Logging, Prometheus Metrics, Trace IDs |

## Quick Start

### Prerequisites

- Node.js 20+
- Yarn
- Azure subscription (for cloud services)

### Local Development

```bash
# Install dependencies
yarn install

# Set up environment variables
cp .env.example .env
# Edit .env with your Azure credentials

# Start development server
yarn start:dev

# Run tests
yarn test

# Build for production
yarn build
```

### Docker/Podman Development (Recommended)

Run everything locally with containers - no global installation needed!

```bash
# Start all services (app, Ollama, Redis, Memcached)
podman compose up -d
# or
docker compose up -d

# Check status
podman compose ps

# View logs
podman compose logs -f app

# Stop all services
podman compose down
```

### LLM Provider Switching

Switch between LLM providers for different use cases:

```bash
# Check current provider
yarn llm:status

# Switch to mock (fast, for load testing - default)
yarn llm:mock

# Switch to local Ollama (realistic, slower)
yarn llm:ollama

# Switch to Azure OpenAI (production)
yarn llm:azure
```

| Provider | Use Case | Performance |
|----------|----------|-------------|
| `mock` | Load testing, CI/CD | ~300ms p95, 0% errors |
| `ollama` | Local development | ~25s avg (phi3:mini) |
| `azure` | Production | Depends on Azure tier |

### Document Conversion (Optional)

Setup Python environment for MarkItDown document conversion:

```bash
# Setup Python virtual environment
yarn setup:python

# Verify installation
.venv/bin/python scripts/markitdown_converter.py --check
```

**Recommended usage:**
- **MarkItDown**: Office documents (DOCX, XLSX, PPTX), HTML, simple text files
- **Azure Document Intelligence**: Complex PDFs, scanned documents, images with OCR

### API Endpoints

```
# Chat Operations (SSE Streaming)
POST   /chat/stream                        # Stream AI responses (SSE)
POST   /chat/stop                          # Stop active stream
GET    /chat/agents                        # List available agents
GET    /chat/status                        # Service status

# Thread Management
GET    /chat/threads                       # List user's threads (paginated)
GET    /chat/threads/:id                   # Get thread details
PATCH  /chat/threads/:id                   # Update thread (title, metadata)
DELETE /chat/threads/:id                   # Soft delete thread
POST   /chat/threads/:id/restore           # Restore deleted thread
DELETE /chat/threads/:id/permanent         # Hard delete thread
GET    /chat/threads/:id/messages          # Get messages (paginated)
POST   /chat/threads/:id/bookmark          # Toggle bookmark

# Search Operations
GET    /search/semantic                    # Semantic search
GET    /search/vector                      # Vector similarity search
GET    /search/hybrid                      # Combined search
POST   /search/index                       # Index documents

# Document Processing
POST   /pdf-extractor                      # Extract text from PDF/image
GET    /pdf-extractor/models               # List Document Intelligence models

# Observability
GET    /metrics                            # Prometheus metrics
GET    /health                             # Health check
```

### Example: Streaming Chat

```typescript
// SSE Event Protocol: metadata → agent_updated* → data* → done
// Using fetch with streaming
const response = await fetch('/chat/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Id': 'user-123'
  },
  body: JSON.stringify({
    threadId: 'thread-456',
    messages: [{ role: 'user', content: 'Explain RAG architecture' }],
    agentType: 'rag'  // normal | rag | multi-agent
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  // Parse SSE events: "event: data\ndata: {...}\n\n"
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      switch (event.event) {
        case 'metadata':
          console.log('Trace ID:', event.data.trace_id);
          break;
        case 'data':
          process.stdout.write(event.data.content);
          break;
        case 'done':
          console.log('\nMessage ID:', event.data.message_id);
          break;
      }
    }
  }
}
```

## Infrastructure Deployment

### Terraform Setup

```bash
# Initialize Terraform
cd iac/infra/service
terraform init

# Plan deployment (dev environment)
./iac/ci/plan_service.sh dev

# Apply deployment
./iac/ci/deploy_service.sh dev

# Deploy application code
./iac/ci/deploy_app.sh dev
```

### Azure Resources Created

| Resource | Purpose |
|----------|---------|
| App Service | NestJS application hosting |
| CosmosDB | Chat thread & message persistence (partition key: `/userId`) |
| Cognitive Search | Vector/semantic search (HNSW, 3072-dim) |
| Document Intelligence | PDF/image text extraction |
| Key Vault | Secrets management |
| Redis (optional) | Distributed stream abort for horizontal scaling |

### Environment Configurations

```
iac/config/
├── dev/config.env      # Development (S1 tier)
├── exp/config.env      # Staging (S1 tier)
└── prod/config.env     # Production (P2v2 tier)
```

## Project Structure

```
src/
├── app.module.ts                # Root module, imports all feature modules
├── chat/                        # Streaming chat module
│   ├── chat.controller.ts       # POST /chat/stream, thread management
│   ├── chat.service.ts          # Orchestrates agents, persistence
│   ├── dto/                     # Request/response DTOs
│   └── services/                # Message history, conversation state
│
├── agents/                      # AI agent system
│   ├── agent.interface.ts       # IAgent, BaseAgent, AgentConfig
│   ├── agent.factory.ts         # Agent registration & instantiation
│   ├── normal/                  # Direct LLM completion agent
│   ├── rag/                     # Retrieval-augmented generation agent
│   └── orchestrator/            # Multi-agent: Planner → Researcher → Writer
│
├── database/                    # Persistence layer (Repository pattern)
│   ├── types.ts                 # IChatRepository, ChatThread, ChatMessageEntity
│   ├── database.module.ts       # Global database module
│   ├── database.factory.ts      # Provider selection factory
│   └── repositories/            # memory, sqlite, cosmosdb implementations
│
├── core/
│   ├── security/                # UserOwnershipGuard
│   ├── observability/           # Logging interceptor, Prometheus metrics
│   ├── streaming/               # SSE infrastructure
│   │   ├── types.ts             # SSEEvent, AgentContext
│   │   ├── sse.service.ts       # Event serialization
│   │   ├── stream-store.*.ts    # Memory/Redis stream stores
│   │   └── stream-abort.service.ts  # Cross-instance abort
│   └── public/
│       ├── pdf-extractor/       # Document Intelligence + LLM
│       └── search/              # Azure Cognitive Search
│
└── config/                      # NestJS ConfigModule setup

iac/
├── ci/                          # CI/CD scripts
├── config/                      # Environment configs (dev/exp/prod)
└── infra/                       # Terraform modules
```

## Enterprise Features

### User Isolation
```typescript
// Every thread/message is scoped to a user
@UseGuards(UserOwnershipGuard)
@RequireOwnership('threadId')
async getThread(@Param('threadId') threadId: string) {
  // Only accessible by thread owner
}
```

### Optimistic Concurrency
```typescript
// ETag-based conflict detection
const result = await chatService.updateThread(
  threadId,
  { title: 'New Title' },
  existingEtag
);
if (!result.success && result.code === 'CONFLICT') {
  // Handle concurrent modification
}
```

### Structured Logging
```json
{
  "timestamp": "2024-12-05T10:30:00.000Z",
  "level": "info",
  "traceId": "abc-123-def",
  "userId": "user-456",
  "method": "POST",
  "path": "/chat/stream",
  "duration": 1234
}
```

## Testing

```bash
# Run all tests
yarn test

# Run with coverage
yarn test:cov

# Run specific test file
yarn test chat.service.spec.ts
```

## Environment Variables

```env
# Azure OpenAI (Responses API)
AZURE_OPENAI_API_INSTANCE_NAME=your-instance
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-5.1
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME=text-embedding-3-large

# Azure AI Foundry (Grok)
AZURE_AI_FOUNDRY_BASE_URL=https://your-resource.services.ai.azure.com/models
AZURE_AI_FOUNDRY_API_KEY=your-key
AZURE_AI_FOUNDRY_MODEL_NAME=grok-3-mini

# Azure Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-endpoint
AZURE_DOCUMENT_INTELLIGENCE_KEY=your-key

# Azure Cognitive Search
AZURE_SEARCH_NAME=your-search-service
AZURE_SEARCH_API_KEY=your-key
AZURE_SEARCH_INDEX_NAME=documents

# Database (default: memory)
DATABASE_PROVIDER=memory|sqlite|cosmosdb

# CosmosDB (required if DATABASE_PROVIDER=cosmosdb)
AZURE_COSMOSDB_ENDPOINT=https://your-account.documents.azure.com:443/
AZURE_COSMOSDB_KEY=your-key
AZURE_COSMOSDB_DATABASE=chatdb
AZURE_COSMOSDB_CONTAINER=chat

# Streaming (optional - for horizontal scaling)
SSE_STREAM_STORE_PROVIDER=memory|redis
REDIS_URL=redis://localhost:6379
```

## Roadmap

- [x] Streaming chat with SSE (RFC 6202 compliant)
- [x] Multi-turn conversations with thread persistence
- [x] Thread management (CRUD, soft delete, restore, bookmark)
- [x] Pluggable database (Memory, SQLite, CosmosDB)
- [x] Multi-agent system (Normal, RAG, Orchestrator)
- [x] Optimistic concurrency with ETags
- [x] User isolation security (ownership guards, partition keys)
- [x] Observability (structured logging, Prometheus metrics, trace IDs)
- [x] Terraform infrastructure (multi-environment)
- [x] Distributed stream abort (Redis Pub/Sub)
- [x] Multi-provider LLM support (Azure OpenAI, Ollama, Mock)
- [x] Header-aware Markdown chunking for RAG
- [x] MarkItDown document conversion (DOCX, XLSX, PPTX)
- [x] LLM timeout handling with graceful fallbacks
- [ ] PostgreSQL + pgvector support
- [ ] Document upload endpoint with per-user storage
- [ ] Knowledge base management UI
- [ ] Admin dashboard

## License

MIT

---

**Built by Quan Nguyen** | [LinkedIn](https://linkedin.com/in/nhq-211211) | [GitHub](https://github.com/211211)
