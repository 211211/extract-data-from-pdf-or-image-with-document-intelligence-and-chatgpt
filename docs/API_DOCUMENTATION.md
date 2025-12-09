# API Documentation

Complete API reference for the AINativeEnterpriseChatApp - Enterprise Chat with RAG, streaming, and multi-agent orchestration.

## Base URL

```
http://localhost:8083/api/v1
```

## Authentication

User identification is provided via the `X-User-Id` header. For production, implement Bearer token authentication.

## Common Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` or `multipart/form-data` |
| `X-User-Id` | **Required for chat endpoints.** User identifier for thread ownership |
| `If-Match` | Optional ETag for optimistic concurrency on updates |

## Error Response Format

All errors follow this structure:

```json
{
  "statusCode": 500,
  "message": "Error description",
  "error": "Internal Server Error"
}
```

---

## Chat Streaming Endpoints

### Stream Chat Response

Streams AI responses using Server-Sent Events (SSE).

```
POST /chat/stream
```

**Request:**
- Content-Type: `application/json`
- Headers: `X-User-Id` (required)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `threadId` | string | No | Thread ID (auto-generated if not provided) |
| `messages` | array | Yes | Array of chat messages |
| `messages[].role` | string | Yes | `user`, `assistant`, or `system` |
| `messages[].content` | string | Yes | Message content |
| `agentType` | string | No | Agent to use: `normal`, `rag`, `multi-agent` (default: `normal`) |

**Example:**
```bash
curl -N -X POST http://localhost:8083/api/v1/chat/stream \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user-123" \
  -d '{
    "threadId": "thread-456",
    "messages": [{ "role": "user", "content": "Explain RAG architecture" }],
    "agentType": "rag"
  }'
```

**SSE Response Format:**
```
event: metadata
data: {"trace_id":"abc-123","stream_id":"xyz-789"}

event: agent_updated
data: {"agent":"researcher","status":"working"}

event: data
data: {"content":"RAG (Retrieval-"}

event: data
data: {"content":"Augmented Generation)..."}

event: done
data: {"message_id":"msg-123"}
```

**Event Types:**

| Event | Description |
|-------|-------------|
| `metadata` | Initial metadata (trace_id, citations) - always first |
| `agent_updated` | Agent state changes (for multi-agent) |
| `data` | Streaming content chunks |
| `done` | Stream complete with message_id |
| `error` | Error occurred |

---

### Stop Active Stream

Cancels an active streaming response.

```
POST /chat/stop
```

**Request:**
- Content-Type: `application/json`
- Headers: `X-User-Id` (required)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `streamId` | string | Yes | Stream ID from metadata event |

**Example:**
```bash
curl -X POST http://localhost:8083/api/v1/chat/stop \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user-123" \
  -d '{"streamId": "xyz-789"}'
```

**Response:**
```json
{
  "success": true,
  "message": "Stream stopped"
}
```

---

### List Available Agents

Returns available AI agents.

```
GET /chat/agents
```

**Example:**
```bash
curl http://localhost:8083/api/v1/chat/agents
```

**Response:**
```json
{
  "agents": [
    { "id": "normal", "name": "Normal Agent", "description": "Direct LLM completion" },
    { "id": "rag", "name": "RAG Agent", "description": "Retrieval-augmented generation" },
    { "id": "multi-agent", "name": "Multi-Agent Orchestrator", "description": "Planner → Researcher → Writer" }
  ]
}
```

---

### Service Status

Returns chat service health status.

```
GET /chat/status
```

**Response:**
```json
{
  "status": "ok",
  "database": "cosmosdb",
  "streamStore": "redis",
  "timestamp": "2024-12-05T10:30:00.000Z"
}
```

---

## Thread Management Endpoints

### List Threads

Returns paginated list of user's threads.

```
GET /chat/threads
```

**Headers:** `X-User-Id` (required)

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | No | 20 | Results per page (max: 50) |
| `continuationToken` | string | No | - | Pagination token |
| `includeDeleted` | boolean | No | false | Include soft-deleted threads |

**Example:**
```bash
curl "http://localhost:8083/api/v1/chat/threads?limit=10" \
  -H "X-User-Id: user-123"
```

**Response:**
```json
{
  "items": [
    {
      "id": "thread-456",
      "userId": "user-123",
      "title": "RAG Architecture Discussion",
      "isBookmarked": true,
      "isDeleted": false,
      "createdAt": "2024-12-05T10:00:00.000Z",
      "lastModifiedAt": "2024-12-05T10:30:00.000Z",
      "_etag": "\"abc123\""
    }
  ],
  "continuationToken": "eyJjb250aW51YXRpb24iOiJ0b2tlbiJ9",
  "hasMore": true
}
```

---

### Get Thread Details

Returns a specific thread with its messages.

```
GET /chat/threads/:threadId
```

**Headers:** `X-User-Id` (required)

**Example:**
```bash
curl http://localhost:8083/api/v1/chat/threads/thread-456 \
  -H "X-User-Id: user-123"
```

**Response:**
```json
{
  "id": "thread-456",
  "userId": "user-123",
  "title": "RAG Architecture Discussion",
  "isBookmarked": false,
  "metadata": {},
  "createdAt": "2024-12-05T10:00:00.000Z",
  "lastModifiedAt": "2024-12-05T10:30:00.000Z",
  "_etag": "\"abc123\""
}
```

---

### Update Thread

Updates thread properties (title, metadata, bookmark).

```
PATCH /chat/threads/:threadId
```

**Headers:**
- `X-User-Id` (required)
- `If-Match` (optional) - ETag for optimistic concurrency

**Request:**
```json
{
  "title": "Updated Title",
  "isBookmarked": true,
  "metadata": { "tags": ["important"] }
}
```

**Response:**
```json
{
  "success": true,
  "entity": { ... },
  "newEtag": "\"def456\""
}
```

**Conflict Response (412):**
```json
{
  "statusCode": 412,
  "message": "Conflict: Resource was modified",
  "currentEtag": "\"xyz789\""
}
```

---

### Delete Thread (Soft)

Soft deletes a thread (can be restored).

```
DELETE /chat/threads/:threadId
```

**Headers:** `X-User-Id` (required)

**Response:**
```json
{
  "success": true,
  "message": "Thread deleted"
}
```

---

### Restore Thread

Restores a soft-deleted thread.

```
POST /chat/threads/:threadId/restore
```

**Headers:** `X-User-Id` (required)

**Response:**
```json
{
  "success": true,
  "message": "Thread restored"
}
```

---

### Permanent Delete Thread

Permanently deletes a thread (cannot be recovered).

```
DELETE /chat/threads/:threadId/permanent
```

**Headers:** `X-User-Id` (required)

**Response:**
```json
{
  "success": true,
  "message": "Thread permanently deleted"
}
```

---

### Get Thread Messages

Returns paginated messages for a thread.

```
GET /chat/threads/:threadId/messages
```

**Headers:** `X-User-Id` (required)

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | No | 30 | Messages per page (max: 100) |
| `continuationToken` | string | No | - | Pagination token |

**Response:**
```json
{
  "items": [
    {
      "id": "msg-123",
      "threadId": "thread-456",
      "role": "user",
      "content": "Explain RAG architecture",
      "createdAt": "2024-12-05T10:00:00.000Z"
    },
    {
      "id": "msg-124",
      "threadId": "thread-456",
      "role": "assistant",
      "content": "RAG (Retrieval-Augmented Generation) is...",
      "createdAt": "2024-12-05T10:00:05.000Z"
    }
  ],
  "continuationToken": null,
  "hasMore": false
}
```

---

### Toggle Bookmark

Toggles the bookmark status of a thread.

```
POST /chat/threads/:threadId/bookmark
```

**Headers:** `X-User-Id` (required)

**Response:**
```json
{
  "success": true,
  "isBookmarked": true
}
```

---

## PDF Extraction Endpoints

### Extract Data (Default Mode)

Extracts structured data from a PDF or image using table/layout analysis mode.

```
POST /pdf-extractor/extract
```

**Request:**
- Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF, JPEG, PNG, or TIFF file |

**Example:**
```bash
curl -X POST http://localhost:8083/api/v1/pdf-extractor/extract \
  -F "file=@document.pdf"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "biomarker_name": "Hemoglobin",
      "biomarker_value": "14.5",
      "unit": "g/dL",
      "reference_range": "12.0-16.0",
      "category": "Haematology"
    }
  ]
}
```

---

### Extract Text (OCR Mode)

Extracts raw text from a document using OCR.

```
POST /pdf-extractor/extract-text
```

**Request:**
- Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF, JPEG, PNG, or TIFF file |

**Example:**
```bash
curl -X POST http://localhost:8083/api/v1/pdf-extractor/extract-text \
  -F "file=@scan.jpeg"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "text": "Extracted text content from the document...",
    "pages": 1,
    "confidence": 0.95
  }
}
```

---

### Extract Tables

Extracts tables and layout structure from a document.

```
POST /pdf-extractor/extract-tables
```

**Request:**
- Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF, JPEG, PNG, or TIFF file |

**Example:**
```bash
curl -X POST http://localhost:8083/api/v1/pdf-extractor/extract-tables \
  -F "file=@report.pdf"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tables": [
      {
        "rows": 5,
        "columns": 3,
        "cells": [
          { "row": 0, "col": 0, "content": "Header 1" },
          { "row": 0, "col": 1, "content": "Header 2" }
        ]
      }
    ],
    "markdown": "| Header 1 | Header 2 |\n|----------|----------|\n| Value 1  | Value 2  |"
  }
}
```

---

### List Available Models

Returns available Azure Document Intelligence models.

```
GET /pdf-extractor/models
```

**Example:**
```bash
curl http://localhost:8083/api/v1/pdf-extractor/models
```

**Response:**
```json
{
  "models": [
    {
      "id": "prebuilt-read",
      "description": "OCR model for text extraction"
    },
    {
      "id": "prebuilt-layout",
      "description": "Layout model for tables and structure"
    },
    {
      "id": "prebuilt-document",
      "description": "General document model"
    },
    {
      "id": "prebuilt-invoice",
      "description": "Invoice-specific extraction"
    }
  ]
}
```

---

## Search Endpoints

### Semantic Search

Performs semantic search using Azure Cognitive Search's AI ranking.

```
GET /search/semantic
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query |
| `top` | number | No | 10 | Number of results |
| `user` | string | No | - | Filter by user |
| `chatThreadId` | string | No | - | Filter by chat thread |

**Example:**
```bash
curl "http://localhost:8083/api/v1/search/semantic?query=biomarker%20results&top=5"
```

**Response:**
```json
{
  "results": [
    {
      "id": "doc-123",
      "pageContent": "Document content...",
      "score": 0.95,
      "metadata": {
        "source": "report.pdf",
        "page": 1
      },
      "captions": [
        {
          "text": "Highlighted matching text...",
          "highlights": "<em>biomarker</em> results show..."
        }
      ]
    }
  ],
  "count": 5
}
```

---

### Vector Search

Performs vector similarity search using embeddings.

```
GET /search/vector
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query |
| `top` | number | No | 10 | Number of results |
| `user` | string | No | - | Filter by user |
| `chatThreadId` | string | No | - | Filter by chat thread |

**Example:**
```bash
curl "http://localhost:8083/api/v1/search/vector?query=cholesterol%20levels&top=5"
```

**Response:**
```json
{
  "results": [
    {
      "id": "doc-456",
      "pageContent": "Document content...",
      "score": 0.89,
      "metadata": {
        "source": "lab-results.pdf"
      }
    }
  ],
  "count": 5
}
```

---

### Hybrid Search

Combines semantic and vector search for best results.

```
GET /search/hybrid
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query |
| `top` | number | No | 10 | Number of results |
| `user` | string | No | - | Filter by user |
| `chatThreadId` | string | No | - | Filter by chat thread |

**Example:**
```bash
curl "http://localhost:8083/api/v1/search/hybrid?query=patient%20diagnosis&top=10"
```

**Response:**
```json
{
  "results": [
    {
      "id": "doc-789",
      "pageContent": "Document content...",
      "semanticScore": 0.92,
      "vectorScore": 0.88,
      "combinedScore": 0.90,
      "metadata": {}
    }
  ],
  "count": 10
}
```

---

### Simple Search

Performs keyword-based search.

```
GET /search/simple
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query |
| `top` | number | No | 10 | Number of results |

**Example:**
```bash
curl "http://localhost:8083/api/v1/search/simple?query=glucose"
```

**Response:**
```json
{
  "results": [
    {
      "id": "doc-abc",
      "pageContent": "...glucose levels measured at...",
      "score": 1.5,
      "metadata": {}
    }
  ],
  "count": 3
}
```

---

### Index Documents

Indexes one or more documents into the search index.

```
POST /search/index
```

**Request:**
- Content-Type: `application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `documents` | array | Yes | Array of documents to index |
| `documents[].id` | string | No | Document ID (auto-generated if not provided) |
| `documents[].pageContent` | string | Yes | Document content |
| `documents[].user` | string | No | User identifier |
| `documents[].chatThreadId` | string | No | Chat thread identifier |
| `documents[].metadata` | string | No | JSON metadata string |

**Example:**
```bash
curl -X POST http://localhost:8083/api/v1/search/index \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "pageContent": "Patient lab results showing elevated glucose levels...",
        "user": "user-123",
        "metadata": "{\"source\": \"lab-report.pdf\", \"date\": \"2024-01-15\"}"
      }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "indexed": 1,
  "ids": ["auto-generated-id-1"]
}
```

---

### Index Folder

Extracts and indexes all PDFs from a local folder.

```
POST /search/index-folder
```

**Request:**
- Content-Type: `application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `folderPath` | string | Yes | Absolute path to folder containing PDFs |
| `user` | string | No | User identifier for all documents |

**Example:**
```bash
curl -X POST http://localhost:8083/api/v1/search/index-folder \
  -H "Content-Type: application/json" \
  -d '{
    "folderPath": "/path/to/pdf/folder",
    "user": "user-123"
  }'
```

**Response:**
```json
{
  "success": true,
  "processed": 15,
  "indexed": 45,
  "errors": []
}
```

---

### Seed Index

Populates the index with sample documents for testing.

```
GET /search/seed
```

**Example:**
```bash
curl http://localhost:8083/api/v1/search/seed
```

**Response:**
```json
{
  "success": true,
  "message": "Index seeded with 8 sample documents"
}
```

---

### Clear Index

Removes all documents from the search index.

```
GET /search/clear
```

**Example:**
```bash
curl http://localhost:8083/api/v1/search/clear
```

**Response:**
```json
{
  "success": true,
  "message": "Index cleared successfully"
}
```

---

### Get All Documents

Retrieves all documents in the index.

```
GET /search/documents
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `top` | number | No | 100 | Maximum documents to return |
| `user` | string | No | - | Filter by user |

**Example:**
```bash
curl "http://localhost:8083/api/v1/search/documents?top=50"
```

**Response:**
```json
{
  "documents": [
    {
      "id": "doc-123",
      "pageContent": "Document content...",
      "user": "user-123",
      "chatThreadId": "thread-456",
      "metadata": "{}"
    }
  ],
  "count": 50,
  "total": 150
}
```

---

### Generate Embedding

Generates an embedding vector for a query (useful for debugging).

```
GET /search/embed
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Text to embed |

**Example:**
```bash
curl "http://localhost:8083/api/v1/search/embed?query=test%20query"
```

**Response:**
```json
{
  "query": "test query",
  "embedding": [0.0123, -0.0456, 0.0789, ...],
  "dimensions": 3072,
  "model": "text-embedding-3-large"
}
```

---

## Health Check

### Root Endpoint

```
GET /
```

**Response:**
```
Hello World!
```

---

## Swagger Documentation

Interactive API documentation is available at:

```
http://localhost:8083/swaggers
```

---

## Rate Limits

The API does not currently implement rate limiting. Azure service limits apply:

| Service | Limit |
|---------|-------|
| Document Intelligence | 15 requests/second |
| Azure OpenAI | Varies by deployment |
| Azure Search | 50 requests/second |

---

## Data Models

### DocumentDto

```typescript
interface DocumentDto {
  id: string;           // Unique document identifier
  pageContent: string;  // Document text content
  embedding?: number[]; // 3072-dimension vector (auto-generated)
  user: string;         // User identifier
  chatThreadId: string; // Chat thread identifier
  metadata: string;     // JSON string with additional metadata
}
```

### BiomarkerResult

```typescript
interface BiomarkerResult {
  biomarker_name: string;    // Name of the biomarker
  biomarker_value: string;   // Measured value
  unit: string;              // Unit of measurement
  reference_range: string;   // Normal range (or "NA")
  category: string;          // Category (e.g., "Haematology")
}
```

### SearchResult

```typescript
interface SearchResult {
  id: string;
  pageContent: string;
  score: number;
  metadata: Record<string, any>;
  captions?: Caption[];       // For semantic search
  highlights?: string[];      // Highlighted matches
}

interface Caption {
  text: string;
  highlights: string;
}
```

---

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 404 | Not Found - Resource doesn't exist |
| 413 | Payload Too Large - File exceeds 50MB |
| 415 | Unsupported Media Type - Invalid file format |
| 422 | Validation Error - Invalid request body |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 502 | Bad Gateway - Azure service unavailable |
| 503 | Service Unavailable |

---

## Examples

### Full Extraction Workflow

```bash
# 1. Extract data from a PDF
curl -X POST http://localhost:8083/api/v1/pdf-extractor/extract \
  -F "file=@lab-report.pdf" \
  -o extracted.json

# 2. Index the extracted content
curl -X POST http://localhost:8083/api/v1/search/index \
  -H "Content-Type: application/json" \
  -d @extracted.json

# 3. Search for specific information
curl "http://localhost:8083/api/v1/search/hybrid?query=cholesterol%20HDL%20LDL&top=5"
```

### Batch Processing

```bash
# Index all PDFs in a folder
curl -X POST http://localhost:8083/api/v1/search/index-folder \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/data/medical-reports", "user": "batch-import"}'
```

---

## SDK Generation

Generate TypeScript client from OpenAPI spec:

```bash
# Get OpenAPI specification
curl http://localhost:8083/api-json -o openapi.json

# Generate TypeScript SDK (using openapi-generator)
npx @openapitools/openapi-generator-cli generate \
  -i openapi.json \
  -g typescript-fetch \
  -o ./sdk
```
