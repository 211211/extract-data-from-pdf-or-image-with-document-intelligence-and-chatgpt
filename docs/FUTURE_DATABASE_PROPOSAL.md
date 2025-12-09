# Future Database Proposal: PostgreSQL + pgvector

> **Status**: CosmosDB implementation is now complete. This proposal outlines the next phase: adding PostgreSQL + pgvector as an additional provider option.

## Overview

This document outlines a proposal to add PostgreSQL with pgvector as an alternative database provider for the chat storage and vector search functionality, providing a cost-effective option for standalone/demo deployments without Azure dependencies.

## Current Architecture (Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│                 Current Setup (Implemented)                  │
├─────────────────────────────────────────────────────────────┤
│  Chat Storage: CosmosDB (prod) / Memory|SQLite (demo)       │
│  Vector Search: Azure AI Search                             │
│  Embeddings: Azure OpenAI text-embedding-3-large (3072-dim) │
│  Repository Pattern: IChatRepository interface              │
│  Database Providers: memory, sqlite, cosmosdb               │
└─────────────────────────────────────────────────────────────┘
```

## Proposed Architecture (Future)

```
┌─────────────────────────────────────────────────────────────┐
│                   Proposed Addition                         │
├─────────────────────────────────────────────────────────────┤
│  Chat Storage: PostgreSQL (JSONB for flexible metadata)     │
│  Vector Search: pgvector extension                          │
│  Embeddings: OpenAI / Azure OpenAI / Local (Ollama)         │
│  Hybrid Search: PostgreSQL FTS + pgvector                   │
│  Provider: DATABASE_PROVIDER=postgres                       │
└─────────────────────────────────────────────────────────────┘
```

## Why PostgreSQL + pgvector?

### Advantages

1. **Single Database** - Chat storage and vector search in one place
2. **Cost Effective** - No separate vector DB service needed
3. **Familiar** - Most developers know PostgreSQL
4. **Production Ready** - Same tech scales from demo to production
5. **Free Hosting** - Supabase, Neon, Railway offer free tiers
6. **Docker Friendly** - Easy local setup with docker-compose
7. **Hybrid Search** - Combine full-text search (BM25) with vector similarity

### Comparison with Alternatives

| Solution | Chat Storage | Vector Search | Hybrid Search | Complexity | Free Tier |
|----------|-------------|---------------|---------------|------------|-----------|
| **PostgreSQL + pgvector** | Excellent | Good | Yes | Low | Supabase, Neon |
| SQLite + sqlite-vec | Good | Limited | Manual | Very Low | Local only |
| Qdrant + SQLite | Good | Excellent | Yes | Medium | Qdrant Cloud |
| Elasticsearch | Good | Good | Excellent | Medium | Elastic Cloud |
| MongoDB Atlas | Good | Good | Yes | Low | Free tier |

## Implementation Plan

> **Note**: The `IChatRepository` interface and database module infrastructure are already in place. Adding PostgreSQL requires implementing a new repository class.

### Phase 1: PostgreSQL Chat Repository

Create `src/database/repositories/postgres.repository.ts`:

```typescript
@Injectable()
export class PostgresChatRepository implements IChatRepository {
  // Implement the existing IChatRepository interface
  // Leverage existing patterns from CosmosDB implementation:
  // - Soft deletes with isDeleted flag
  // - Optimistic concurrency with _version field
  // - Continuation token pagination
  // Add PostgreSQL-specific optimizations:
  // - JSONB for metadata
  // - Composite indexes
  // - Connection pooling with pg-pool
}
```

Update `src/database/database.factory.ts`:
```typescript
getRepository(): IChatRepository {
  switch (this.configService.get('DATABASE_PROVIDER')) {
    case 'postgres':
      return this.postgresRepository;
    // ... existing cases
  }
}
```

### Phase 2: Vector Search Integration

Create `src/database/repositories/postgres-vector.repository.ts`:

```typescript
export interface IVectorRepository {
  // Document indexing
  indexDocument(doc: VectorDocument): Promise<void>;
  bulkIndexDocuments(docs: VectorDocument[]): Promise<void>;

  // Search operations
  semanticSearch(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  vectorSearch(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
  hybridSearch(query: string, embedding: number[], options?: HybridOptions): Promise<SearchResult[]>;

  // Management
  deleteDocument(id: string): Promise<boolean>;
  clearIndex(): Promise<void>;
}
```

### Phase 3: Embeddings Abstraction

Create `src/embeddings/embeddings.interface.ts`:

```typescript
export interface IEmbeddingsProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

// Implementations:
// - AzureOpenAIEmbeddings (current)
// - OpenAIEmbeddings
// - OllamaEmbeddings (local, free)
```

## Database Schema

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Chat threads table
CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL DEFAULT 'CHAT_THREAD',
  user_id VARCHAR(255) NOT NULL,
  title VARCHAR(500),
  is_bookmarked BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  trace_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _version INTEGER NOT NULL DEFAULT 1
);

-- Composite indexes for efficient queries
CREATE INDEX idx_threads_user_deleted_modified
  ON threads(user_id, is_deleted, last_modified_at DESC);
CREATE INDEX idx_threads_user_bookmarked
  ON threads(user_id, is_bookmarked, last_modified_at DESC)
  WHERE is_deleted = FALSE;

-- Chat messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL DEFAULT 'CHAT_MESSAGE',
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_messages_thread_deleted_created
  ON messages(thread_id, is_deleted, created_at ASC);

-- Vector documents table (for RAG)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536),  -- OpenAI ada-002 dimension
  metadata JSONB DEFAULT '{}',
  source VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vector similarity index (IVFFlat for large datasets)
CREATE INDEX idx_documents_embedding
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text search index
CREATE INDEX idx_documents_content_fts
  ON documents USING gin(to_tsvector('english', content));
```

## Search Implementation

```typescript
// Semantic search (vector similarity)
async semanticSearch(embedding: number[], limit = 10): Promise<SearchResult[]> {
  const result = await this.pool.query(`
    SELECT id, content, metadata, source,
           1 - (embedding <=> $1::vector) as score
    FROM documents
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `, [JSON.stringify(embedding), limit]);

  return result.rows;
}

// Hybrid search (vector + full-text)
async hybridSearch(
  query: string,
  embedding: number[],
  options: { vectorWeight?: number; limit?: number }
): Promise<SearchResult[]> {
  const { vectorWeight = 0.7, limit = 10 } = options;
  const textWeight = 1 - vectorWeight;

  const result = await this.pool.query(`
    WITH vector_scores AS (
      SELECT id, 1 - (embedding <=> $1::vector) as vector_score
      FROM documents
    ),
    text_scores AS (
      SELECT id, ts_rank(to_tsvector('english', content), plainto_tsquery($2)) as text_score
      FROM documents
      WHERE to_tsvector('english', content) @@ plainto_tsquery($2)
    )
    SELECT d.id, d.content, d.metadata, d.source,
           COALESCE(v.vector_score, 0) * $3 + COALESCE(t.text_score, 0) * $4 as score
    FROM documents d
    LEFT JOIN vector_scores v ON d.id = v.id
    LEFT JOIN text_scores t ON d.id = t.id
    WHERE v.vector_score IS NOT NULL OR t.text_score IS NOT NULL
    ORDER BY score DESC
    LIMIT $5
  `, [JSON.stringify(embedding), query, vectorWeight, textWeight, limit]);

  return result.rows;
}
```

## Configuration

```bash
# .env additions
DATABASE_PROVIDER=postgres  # memory | sqlite | postgres

# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=chatdb
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_SSL=false

# Connection pooling
POSTGRES_POOL_MIN=2
POSTGRES_POOL_MAX=10

# Vector search configuration
VECTOR_DIMENSION=1536
VECTOR_INDEX_TYPE=ivfflat  # ivfflat | hnsw

# Embeddings provider
EMBEDDINGS_PROVIDER=azure  # azure | openai | ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
```

## Docker Compose for Local Development

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: chat-postgres
    environment:
      POSTGRES_DB: chatdb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: localdev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Optional: Ollama for local embeddings
  ollama:
    image: ollama/ollama
    container_name: chat-ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

volumes:
  postgres_data:
  ollama_data:
```

## Migration Path

### From Memory/SQLite to PostgreSQL

1. Export existing data using repository methods
2. Configure PostgreSQL connection
3. Run schema migrations
4. Import data to PostgreSQL
5. Update `DATABASE_PROVIDER=postgres`

### From Azure AI Search to pgvector

1. Export indexed documents
2. Generate embeddings (if not stored)
3. Insert into PostgreSQL documents table
4. Update search service configuration

## Performance Considerations

### Indexing Strategy

| Index Type | Use Case | Memory | Build Time | Query Time |
|------------|----------|--------|------------|------------|
| **IVFFlat** | 100K-1M vectors | Low | Fast | Good |
| **HNSW** | 1M+ vectors | High | Slow | Excellent |

### Recommendations

- Start with IVFFlat for demos (<1M documents)
- Use HNSW for production with large datasets
- Set `lists` parameter to `sqrt(row_count)` for IVFFlat
- Use connection pooling (pg-pool) for high concurrency

## Effort Estimate

| Phase | Description | Effort |
|-------|-------------|--------|
| Phase 1 | PostgreSQL chat repository | 2-3 days |
| Phase 2 | Vector search integration | 2-3 days |
| Phase 3 | Embeddings abstraction | 1-2 days |
| Phase 4 | Testing & documentation | 1-2 days |

> **Note**: The repository interface and database module infrastructure are already complete, reducing integration effort.

## Open Questions

1. Should we support multiple embedding dimensions (ada-002: 1536, ada-003: 3072)?
2. Do we need to support document chunking in the repository layer?
3. Should hybrid search weights be configurable per query?
4. Do we need a migration tool for Azure AI Search → pgvector?

## References

- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [Supabase Vector](https://supabase.com/docs/guides/ai/vector-columns)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [Neon Serverless Postgres](https://neon.tech/)
