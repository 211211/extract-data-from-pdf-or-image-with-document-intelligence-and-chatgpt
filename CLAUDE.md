# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A production-ready **Enterprise ChatGPT-like Application** built with NestJS and Azure AI services. Features RAG (Retrieval-Augmented Generation), SSE streaming, multi-agent orchestration, and enterprise-grade patterns (optimistic concurrency, soft deletes, user isolation).

## Commands

```bash
# Development
yarn install              # Install dependencies
yarn start:dev            # Start with hot reload (default port: 8083)
yarn start:debug          # Start with debugger attached

# Build & Production
yarn build                # Compile TypeScript
yarn start:prod           # Run compiled code

# Testing
yarn test                 # Run Jest tests
yarn test:watch           # Watch mode
yarn test:cov             # Coverage report
yarn test -- path/to/test.spec.ts  # Run single test file

# Code Quality
yarn lint                 # ESLint with auto-fix
yarn format               # Prettier formatting

# Search Index Management
yarn seed                 # Seed Azure search index
yarn clear-index          # Clear search index
```

## Architecture

### Module Structure

```
src/
├── app.module.ts              # Root module, imports all feature modules
├── chat/                      # Streaming chat with thread/message CRUD
│   ├── chat.controller.ts     # POST /chat/stream, thread management
│   ├── chat.service.ts        # Orchestrates agents, persistence
│   └── services/              # Message history, conversation state
├── agents/                    # AI agent system
│   ├── agent.interface.ts     # IAgent, BaseAgent, AgentConfig
│   ├── agent.factory.ts       # Agent instantiation (normal, rag, multi-agent)
│   ├── normal/                # Direct LLM completion
│   ├── rag/                   # Retrieval-augmented generation
│   └── orchestrator/          # Multi-agent: Planner → Researcher → Writer
├── database/                  # Persistence layer (Repository pattern)
│   ├── types.ts               # IChatRepository, ChatThread, ChatMessageEntity
│   └── repositories/          # memory, sqlite, cosmosdb implementations
├── core/
│   ├── streaming/             # SSE infrastructure
│   │   ├── types.ts           # SSEEvent, AgentContext, event payloads
│   │   ├── sse.service.ts     # Event serialization
│   │   └── stream-abort.service.ts  # Stream cancellation
│   ├── observability/         # Logging interceptor, Prometheus metrics
│   ├── security/              # UserOwnershipGuard
│   └── public/
│       ├── pdf-extractor/     # Document Intelligence + LLM extraction
│       └── search/            # Azure Cognitive Search (vector, semantic, hybrid)
└── config/                    # NestJS ConfigModule setup
```

### Request Flow

1. **Chat Streaming**: `POST /chat/stream` → `ChatController` → `ChatService.processChat()` → `AgentFactory.getAgent()` → Agent yields SSEEvents → Controller streams via Response
2. **Document Extraction**: `POST /pdf-extractor` → Document Intelligence (Azure) → LLM completion (Grok/GPT) → JSON response
3. **Search**: Query → Embedding generation → Azure Cognitive Search (vector/semantic/hybrid) → Ranked results

### SSE Event Protocol

Agents are async generators yielding events in this sequence:
```
metadata (required first) → agent_updated (optional, repeats for multi-agent) → data (streaming content, repeats) → done (required last)
```

On error: `error` event can be emitted at any point.

### Key Patterns

- **Agent Interface**: All agents implement `IAgent.run(context, config): AsyncGenerator<SSEEvent>`
- **Repository Pattern**: `IChatRepository` with memory/sqlite/cosmosdb implementations
- **Provider Factory**: Azure clients created via NestJS providers (`DocumentIntelligenceProvider`, `OpenAIProvider`, etc.)
- **Optimistic Concurrency**: ETags for conflict detection on updates
- **Soft Deletes**: `isDeleted` flag with restore capability

## API Endpoints

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

Swagger UI available at `/swaggers`

## Azure Services

| Service | Purpose | Key Config |
|---------|---------|------------|
| **Azure OpenAI** | GPT-5.1, embeddings | Uses Responses API (`/openai/responses`), API version `2025-04-01-preview` |
| **Azure AI Foundry** | Grok-3-mini | Alternative LLM provider |
| **Azure Document Intelligence** | PDF/image OCR | `prebuilt-layout` for tables, `prebuilt-read` for text |
| **Azure Cognitive Search** | Vector + semantic search | HNSW algorithm, 3072-dim embeddings |
| **Azure CosmosDB** | Chat persistence | Partition key `/userId`, single container with type discriminator |

## Environment Variables

Required in `.env`:
```
# Azure OpenAI (Responses API)
AZURE_OPENAI_API_INSTANCE_NAME=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-5.1
AZURE_OPENAI_API_VERSION=2025-04-01-preview

# Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=

# Cognitive Search
AZURE_SEARCH_NAME=
AZURE_SEARCH_API_KEY=
AZURE_SEARCH_INDEX_NAME=

# Database (CosmosDB recommended for production)
DATABASE_PROVIDER=cosmosdb  # or memory|sqlite for dev
AZURE_COSMOSDB_ENDPOINT=https://your-account.documents.azure.com:443/
AZURE_COSMOSDB_KEY=
AZURE_COSMOSDB_DATABASE=chatdb
AZURE_COSMOSDB_CONTAINER=chat

# Streaming (Redis for horizontal scaling)
SSE_STREAM_STORE_PROVIDER=memory  # or redis for distributed abort
REDIS_URL=redis://localhost:6379  # Required if redis

# LLM Observability (Langfuse self-hosted)
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://localhost:3000
```

## Langfuse Integration

LLM observability via self-hosted Langfuse (MIT license):
- **Traces**: Track conversations with user/session IDs
- **Generations**: LLM calls with model, parameters, token usage
- **Spans**: Document search operations in RAG workflows
- See `docs/LANGFUSE_SETUP.md` for setup instructions

## Infrastructure

Terraform in `iac/`:
```bash
cd iac/infra/service
./iac/ci/plan_service.sh dev    # Plan deployment
./iac/ci/deploy_service.sh dev  # Apply
./iac/ci/deploy_app.sh dev      # Deploy app code
```

Environments: `iac/config/{dev,exp,prod}/config.env`

## Testing Notes

- Test files: `*.spec.ts` alongside source files
- Jest environment: `node` (default)
- Mock `AgentFactory` when testing `ChatService`
- SSE testing: Use `curl -N` for streaming validation
