# Architecture Documentation

This document describes the system architecture, design patterns, and technical decisions for the AINativeEnterpriseChatApp - a production-ready enterprise chat application with RAG, streaming, and multi-agent orchestration.

## Table of Contents

1. [System Overview](#system-overview)
2. [Layer Architecture](#layer-architecture)
3. [Module Design](#module-design)
4. [Data Flow](#data-flow)
5. [Design Patterns](#design-patterns)
6. [Database Layer](#database-layer)
7. [Streaming Infrastructure](#streaming-infrastructure)
8. [Agent System](#agent-system)
9. [Azure Services Integration](#azure-services-integration)
10. [Scalability Considerations](#scalability-considerations)

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                    │
│                    (Web Apps, Mobile Apps, CLI Tools)                        │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS/REST
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                           API Gateway Layer                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     NestJS Application                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │   │
│  │  │ Middleware  │  │   Guards    │  │Interceptors │  │   Pipes    │ │   │
│  │  │ (CORS,Body) │  │  (Auth)     │  │  (Error)    │  │(Validation)│ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                          Controller Layer                                    │
│                                                                              │
│  ┌──────────────────────────┐        ┌──────────────────────────┐          │
│  │  PdfExtractorController  │        │    SearchController      │          │
│  │  - POST /extract         │        │  - GET /semantic         │          │
│  │  - POST /extract-text    │        │  - GET /vector           │          │
│  │  - POST /extract-tables  │        │  - GET /hybrid           │          │
│  │  - GET /models           │        │  - POST /index           │          │
│  └────────────┬─────────────┘        └────────────┬─────────────┘          │
└───────────────┼──────────────────────────────────┼──────────────────────────┘
                │                                  │
┌───────────────▼──────────────────────────────────▼──────────────────────────┐
│                           Service Layer                                      │
│                                                                              │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │     PdfExtractorService         │  │        SearchService            │  │
│  │  - Orchestrates extraction      │  │  - Query execution              │  │
│  │  - Mode selection               │  │  - Result ranking               │  │
│  └───────────┬─────────────────────┘  └───────────┬─────────────────────┘  │
│              │                                    │                         │
│  ┌───────────▼─────────────────────┐  ┌───────────▼─────────────────────┐  │
│  │   DocumentAnalysisService       │  │       IndexerService            │  │
│  │  - Azure Doc Intel integration  │  │  - Document processing          │  │
│  │  - OCR and layout analysis      │  │  - Chunking strategy            │  │
│  └───────────┬─────────────────────┘  └───────────┬─────────────────────┘  │
│              │                                    │                         │
│  ┌───────────▼─────────────────────┐  ┌───────────▼─────────────────────┐  │
│  │     CompletionService           │  │   AzureCogVectorStore           │  │
│  │  - LLM integration (Grok/GPT)   │  │  - Embedding generation         │  │
│  │  - Structured data extraction   │  │  - Index management             │  │
│  └─────────────────────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                         Provider Layer                                       │
│                     (Azure Client Factories)                                 │
│                                                                              │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌──────────────┐ │
│  │ DocumentIntel  │ │  OpenAI        │ │    Grok        │ │  Embedding   │ │
│  │   Provider     │ │  Provider      │ │   Provider     │ │   Provider   │ │
│  └───────┬────────┘ └───────┬────────┘ └───────┬────────┘ └──────┬───────┘ │
└──────────┼──────────────────┼──────────────────┼─────────────────┼──────────┘
           │                  │                  │                 │
┌──────────▼──────────────────▼──────────────────▼─────────────────▼──────────┐
│                          Azure Cloud Services                                │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │    Document      │  │   Azure OpenAI   │  │ Azure Cognitive  │          │
│  │  Intelligence    │  │   / AI Foundry   │  │     Search       │          │
│  │                  │  │                  │  │                  │          │
│  │  - prebuilt-read │  │  - gpt-4o        │  │  - Vector index  │          │
│  │  - prebuilt-     │  │  - grok-3-mini   │  │  - Semantic rank │          │
│  │    layout        │  │  - text-embed-   │  │  - HNSW algo     │          │
│  │                  │  │    3-large       │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Architecture

### 1. API Gateway Layer

The entry point for all HTTP requests. Handles cross-cutting concerns.

**Components:**
- **Body Parser Middleware**: 50MB limit for large document uploads
- **ValidationPipe**: DTO validation with class-validator
- **CORS**: Configured for allowed origins
- **Global Prefix**: `/api/v1` for versioning

```typescript
// main.ts configuration
app.useGlobalPipes(new ValidationPipe({ transform: true }));
app.enableCors({ origin: 'http://localhost:3000' });
app.setGlobalPrefix('/api/v1');
```

### 2. Controller Layer

REST endpoint definitions with request/response handling.

**Responsibilities:**
- Route definition with decorators
- Request parameter extraction
- Response formatting
- File upload handling (multipart/form-data)

**Pattern:** Thin controllers that delegate to services

```typescript
@Controller('pdf-extractor')
export class PdfExtractorController {
  @Post('extract')
  @UseInterceptors(FileInterceptor('file'))
  async extract(@UploadedFile() file: Express.Multer.File) {
    return this.pdfExtractorService.extract(file, 'tables');
  }
}
```

### 3. Service Layer

Business logic implementation with clear separation of concerns.

**Service Types:**

| Service | Responsibility |
|---------|----------------|
| `PdfExtractorService` | Orchestrates extraction workflow |
| `DocumentAnalysisService` | Azure Document Intelligence integration |
| `CompletionService` | LLM completion (Grok/GPT) |
| `SearchService` | Query execution and ranking |
| `IndexerService` | Document processing and indexing |
| `AzureCogVectorStore` | Vector storage operations |

### 4. Provider Layer

Factory pattern for Azure client instantiation.

**Providers:**
- `DocumentIntelligenceProvider` - Azure Document Intelligence client
- `OpenAIProvider` - Standard OpenAI client
- `AzureOpenAIProvider` - Azure-hosted OpenAI client
- `Grok3Provider` - Azure AI Foundry Grok client
- `AzureOpenAIEmbeddingProvider` - Embedding model client

```typescript
// Provider pattern example
export const DocumentIntelligenceProvider = {
  provide: 'DOCUMENT_INTELLIGENCE_CLIENT',
  useFactory: () => {
    return DocumentIntelligence(
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
      { key: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY }
    );
  },
};
```

---

## Module Design

### Module Dependency Graph

```
AppModule
├── ConfigModule (global)
├── PdfExtractorModule
│   ├── DocumentIntelligenceProvider
│   ├── OpenAIProvider
│   ├── Grok3Provider
│   ├── DocumentAnalysisService
│   ├── CompletionService
│   └── PdfExtractorService
└── SearchModule
    ├── AzureOpenAIEmbeddingProvider
    ├── SearchService
    ├── IndexerService
    └── AzureCogVectorStore
```

### PdfExtractorModule

Handles document analysis and AI-powered data extraction.

```typescript
@Module({
  controllers: [PdfExtractorController],
  providers: [
    DocumentIntelligenceProvider,
    OpenAIProvider,
    Grok3Provider,
    DocumentAnalysisService,
    CompletionService,
    PdfExtractorService,
  ],
  exports: [PdfExtractorService],
})
export class PdfExtractorModule {}
```

### SearchModule

Handles document indexing and search operations.

```typescript
@Module({
  imports: [PdfExtractorModule],
  controllers: [SearchController],
  providers: [
    AzureOpenAIEmbeddingProvider,
    SearchService,
    IndexerService,
  ],
})
export class SearchModule {}
```

---

## Data Flow

### PDF Extraction Flow

```
┌──────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  Client  │────▶│ PdfExtractor      │────▶│ DocumentAnalysis    │
│  Upload  │     │ Controller        │     │ Service             │
└──────────┘     └───────────────────┘     └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ Azure Document      │
                                           │ Intelligence        │
                                           │ (prebuilt-layout)   │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
┌──────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  JSON    │◀────│ Completion        │◀────│ Extracted Text/     │
│ Response │     │ Service (Grok)    │     │ Tables (Markdown)   │
└──────────┘     └───────────────────┘     └─────────────────────┘
```

### Search Flow

```
┌──────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  Query   │────▶│ Search            │────▶│ Embedding           │
│          │     │ Controller        │     │ Service             │
└──────────┘     └───────────────────┘     └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ Azure OpenAI        │
                                           │ (text-embedding-    │
                                           │  3-large)           │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
┌──────────┐     ┌───────────────────┐     ┌─────────────────────┐
│ Ranked   │◀────│ Azure Cognitive   │◀────│ Query Vector        │
│ Results  │     │ Search            │     │ (3072 dimensions)   │
└──────────┘     └───────────────────┘     └─────────────────────┘
```

### Document Indexing Flow

```
┌──────────┐     ┌───────────────────┐     ┌─────────────────────┐
│ Document │────▶│ Indexer           │────▶│ Text Chunking       │
│          │     │ Service           │     │ (LangChain)         │
└──────────┘     └───────────────────┘     └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ Chunks              │
                                           │ (2500 chars,        │
                                           │  300 overlap)       │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
┌──────────┐     ┌───────────────────┐     ┌─────────────────────┐
│ Indexed  │◀────│ Azure Cognitive   │◀────│ Embeddings          │
│          │     │ Search            │     │ (batch upload)      │
└──────────┘     └───────────────────┘     └─────────────────────┘
```

---

## Design Patterns

### 1. Dependency Injection (NestJS IoC)

All services use constructor injection for dependencies.

```typescript
@Injectable()
export class PdfExtractorService {
  constructor(
    private readonly documentAnalysisService: DocumentAnalysisService,
    private readonly completionService: CompletionService,
  ) {}
}
```

### 2. Provider Factory Pattern

Azure clients are created through factory providers.

```typescript
export const DocumentIntelligenceProvider = {
  provide: 'DOCUMENT_INTELLIGENCE_CLIENT',
  useFactory: () => createClient(endpoint, credential),
};
```

### 3. Interface Segregation

Services implement focused interfaces.

```typescript
export interface ICompletionService {
  complete(prompt: string, analysisResult: string): Promise<string>;
}

export interface IDocumentAnalysisService {
  analyze(file: Buffer, model: string): Promise<AnalysisResult>;
}
```

### 4. Strategy Pattern (Implicit)

Different extraction modes use different configurations.

```typescript
// Mode-based configuration
const config = mode === 'text'
  ? { model: 'prebuilt-read', outputFormat: 'text' }
  : { model: 'prebuilt-layout', outputFormat: 'markdown' };
```

### 5. Repository Pattern (Search)

`AzureCogVectorStore` acts as a repository for document operations.

```typescript
class AzureCogVectorStore {
  async indexDocuments(documents: DocumentDto[]): Promise<void>;
  async vectorSearch(query: string, topK: number): Promise<SearchResult[]>;
  async semanticSearch(query: string, topK: number): Promise<SearchResult[]>;
  async clearIndex(): Promise<void>;
}
```

---

## Azure Services Integration

### Azure Document Intelligence

**Models Used:**
- `prebuilt-read`: OCR for text extraction
- `prebuilt-layout`: Tables, figures, and layout analysis

**Features:**
- High-resolution OCR for images
- Long-running operation polling
- Markdown/text output formats

### Azure OpenAI / AI Foundry

**API Version:** `2025-04-01-preview` (Responses API)

**Important:** This project uses the Azure OpenAI **Responses API** (`/openai/responses`) instead of the traditional Chat Completions API (`/openai/deployments/{model}/chat/completions`). The Responses API provides:
- Unified endpoint for all models
- Enhanced streaming capabilities
- Support for newer model features

**Models:**
- `gpt-5.1`: Latest high-capability completion model
- `grok-3-mini`: Fast, cost-effective completion
- `text-embedding-3-large`: 3072-dimension embeddings

**Responses API Request Format:**
```typescript
// Endpoint: https://{instance}.openai.azure.com/openai/responses?api-version=2025-04-01-preview
{
  model: "gpt-5.1",
  input: [
    { type: "message", role: "system", content: "..." },
    { type: "message", role: "user", content: "..." }
  ],
  stream: true,
  max_output_tokens: 4096,
  temperature: 0.7
}
```

**Streaming Response Events:**
- `response.output_text.delta`: Contains `delta` field with text chunks

### Azure Cognitive Search

**Index Configuration:**
```typescript
{
  fields: [
    { name: 'id', type: 'Edm.String', key: true },
    { name: 'pageContent', type: 'Edm.String', searchable: true },
    { name: 'embedding', type: 'Collection(Edm.Single)',
      dimensions: 3072, vectorSearchProfile: 'vector-profile' },
    { name: 'user', type: 'Edm.String', filterable: true },
    { name: 'chatThreadId', type: 'Edm.String', filterable: true },
  ],
  vectorSearch: {
    algorithms: [{ name: 'hnsw-algo', kind: 'hnsw' }],
    profiles: [{ name: 'vector-profile', algorithm: 'hnsw-algo' }]
  },
  semantic: {
    configurations: [{
      name: 'semantic-config',
      prioritizedFields: { contentFields: [{ fieldName: 'pageContent' }] }
    }]
  }
}
```

---

## Scalability Considerations

### Current Limitations

1. **Single Instance**: No horizontal scaling support
2. **Synchronous Processing**: Large documents block the event loop
3. **No Caching**: Repeated queries hit Azure services directly
4. **No Rate Limiting**: Azure API limits not managed

### Recommended Improvements

1. **Background Processing**: Use BullMQ for document ingestion
2. **Caching Layer**: Redis for embeddings and search results
3. **Connection Pooling**: Reuse Azure client connections
4. **Horizontal Scaling**: Kubernetes with worker sharding
5. **Circuit Breaker**: Handle Azure service outages gracefully

### Implemented Improvements

The following improvements have been implemented:

1. **Horizontal Scaling**: Redis-based stream store for distributed abort signals
2. **Repository Pattern**: Pluggable database (Memory, SQLite, CosmosDB)
3. **Multi-Agent System**: Extensible agent framework with orchestration
4. **Optimistic Concurrency**: ETag-based conflict detection
5. **User Isolation**: Partition keys and ownership guards

See [MULTI_AGENT_IMPLEMENTATION.md](./MULTI_AGENT_IMPLEMENTATION.md) for guidance on the multi-agent architecture.

---

## Database Layer

The application uses a Repository pattern with pluggable implementations.

### Entity Model

```typescript
// Base entity shared by all types
interface BaseEntity {
  id: string;
  type: 'CHAT_THREAD' | 'CHAT_MESSAGE';
  userId: string;         // Partition key for CosmosDB
  createdAt: Date;
  lastModifiedAt: Date;
  isDeleted: boolean;     // Soft delete support
  _etag?: string;         // Optimistic concurrency
  _version?: number;      // Cache invalidation
}

// Chat thread entity
interface ChatThread extends BaseEntity {
  title?: string;
  isBookmarked?: boolean;
  metadata?: ThreadMetadata;
  traceId?: string;       // Distributed tracing
}

// Chat message entity
interface ChatMessageEntity extends BaseEntity {
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;
}
```

### Repository Interface

```typescript
interface IChatRepository {
  // Thread operations
  createThread(thread: Partial<ChatThread>): Promise<ChatThread>;
  getThread(id: string, userId: string): Promise<ChatThread | null>;
  updateThread(id: string, updates: Partial<ChatThread>, options?: UpdateOptions): Promise<UpdateResult<ChatThread>>;
  deleteThread(id: string, userId: string): Promise<boolean>;
  restoreThread(id: string, userId: string): Promise<boolean>;
  listThreads(options: ListOptions): Promise<PaginatedResult<ChatThread>>;

  // Message operations
  createMessage(message: Partial<ChatMessageEntity>): Promise<ChatMessageEntity>;
  getMessages(threadId: string, options?: PaginationOptions): Promise<PaginatedResult<ChatMessageEntity>>;
  upsertMessage(message: Partial<ChatMessageEntity>): Promise<ChatMessageEntity>;

  // Lifecycle
  onModuleInit(): Promise<void>;
  isHealthy(): Promise<boolean>;
}
```

### Database Providers

| Provider | Use Case | Persistence | Scaling |
|----------|----------|-------------|---------|
| **Memory** | Development, testing | None | Single instance |
| **SQLite** | Standalone demo | File-based | Single instance |
| **CosmosDB** | Production | Cloud | Horizontal |

### CosmosDB Design

- **Single Container**: All threads and messages in one container
- **Partition Key**: `/userId` for user isolation and efficient queries
- **Type Discriminator**: `type` field differentiates entity types
- **Composite Indexes**: Optimized for common query patterns

```
Composite Indexes:
├── (userId, type, lastModifiedAt DESC)  # Thread listing
├── (userId, type, createdAt ASC)        # Message history
└── (threadId, createdAt ASC)            # Thread messages
```

---

## Streaming Infrastructure

Real-time SSE streaming with distributed abort support.

### SSE Event Protocol

Agents yield events in this sequence:

```
metadata (required) → agent_updated* → data* → done (required)
        │                 │              │           │
        │                 │              │           └─ Final event with message_id
        │                 │              └─ Streaming content chunks
        │                 └─ Agent state changes (multi-agent)
        └─ Initial metadata (trace_id, citations)
```

### Event Types

```typescript
type SSEEventType = 'metadata' | 'agent_updated' | 'data' | 'done' | 'error';

interface SSEEvent<T = unknown> {
  event: SSEEventType;
  data: T;
}

// Example events
{ event: 'metadata', data: { trace_id: 'abc', stream_id: '123' } }
{ event: 'agent_updated', data: { agent: 'researcher', status: 'working' } }
{ event: 'data', data: { content: 'Hello' } }
{ event: 'done', data: { message_id: 'msg-456' } }
```

### Stream Store Implementations

| Store | Abort Scope | Use Case |
|-------|-------------|----------|
| **InMemoryStreamStore** | Local instance | Single server |
| **RedisStreamStore** | Cross-instance | Horizontal scaling |

Redis uses Pub/Sub for abort signals across instances.

---

## Agent System

Extensible multi-agent architecture with factory pattern.

### Agent Interface

```typescript
interface IAgent {
  readonly name: string;
  readonly description?: string;
  run(context: AgentContext, config?: AgentConfig): AsyncGenerator<SSEEvent>;
}
```

### Available Agents

| Agent | Purpose | Key Features |
|-------|---------|--------------|
| **NormalAgent** | Direct LLM completion | Simple Q&A |
| **RAGAgent** | Retrieval-augmented | Vector search + LLM |
| **MultiAgentOrchestrator** | Complex tasks | Planner → Researcher → Writer |

### Multi-Agent Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Planner   │────▶│ Researcher  │────▶│   Writer    │
│             │     │             │     │             │
│ Breaks down │     │ Gathers     │     │ Synthesizes │
│ the task    │     │ information │     │ response    │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Agent Registration

```typescript
// agents.module.ts
@Module({
  providers: [
    AgentFactory,
    NormalAgent,
    RAGAgent,
    MultiAgentOrchestrator,
  ],
})
export class AgentsModule implements OnModuleInit {
  onModuleInit() {
    this.factory.registerInstance('normal', this.normalAgent);
    this.factory.registerInstance('rag', this.ragAgent);
    this.factory.registerInstance('multi-agent', this.orchestrator);
  }
}
```

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `APP_PORT` | Server port | Yes |
| `APP_BASE_PATH` | API prefix | Yes |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Doc Intel endpoint | Yes |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Doc Intel key | Yes |
| `AZURE_OPENAI_API_INSTANCE_NAME` | Azure OpenAI instance name | Yes |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | Yes |
| `AZURE_OPENAI_API_VERSION` | API version (use `2025-04-01-preview` for Responses API) | Yes |
| `AZURE_OPENAI_API_DEPLOYMENT_NAME` | Model deployment name (e.g., `gpt-5.1`) | Yes |
| `AZURE_SEARCH_NAME` | Search service name | Yes |
| `AZURE_SEARCH_API_KEY` | Search service key | Yes |
| `AZURE_SEARCH_INDEX_NAME` | Index name | Yes |
| `DATABASE_PROVIDER` | Database provider (`memory`, `sqlite`, `cosmosdb`) | No (default: `memory`) |
| `AZURE_COSMOSDB_ENDPOINT` | CosmosDB endpoint | If cosmosdb |
| `AZURE_COSMOSDB_KEY` | CosmosDB key | If cosmosdb |
| `AZURE_COSMOSDB_DATABASE` | CosmosDB database name | If cosmosdb |
| `AZURE_COSMOSDB_CONTAINER` | CosmosDB container name | If cosmosdb |
| `SSE_STREAM_STORE_PROVIDER` | Stream store (`memory`, `redis`) | No (default: `memory`) |
| `REDIS_URL` | Redis URL for distributed abort | If redis |

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## Security Considerations

1. **API Keys**: Store in environment variables, never in code
2. **Input Validation**: Use class-validator for all DTOs
3. **File Uploads**: Validate MIME types and file sizes
4. **CORS**: Restrict to known origins in production
5. **Rate Limiting**: Implement at API gateway level
