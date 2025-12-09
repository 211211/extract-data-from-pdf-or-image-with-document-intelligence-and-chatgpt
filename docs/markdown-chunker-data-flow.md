# Markdown Chunker - Data Flow

This document describes how the enhanced `MarkdownChunker` processes documents, inspired by best practices from the sensei-server project.

## Overview

The chunker transforms raw documents into structured chunks with metadata, optimized for vector search and RAG (Retrieval-Augmented Generation) workflows.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Document Sources                                                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │ DOCX/XLSX/  │    │ PDF/Images  │    │ Already     │                  │
│  │ PPTX        │    │ (scanned)   │    │ Markdown    │                  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
│         │                  │                  │                          │
│         ▼                  ▼                  │                          │
│  ┌─────────────┐    ┌─────────────────┐      │                          │
│  │ MarkItDown  │    │ Azure Document  │      │                          │
│  │ (local)     │    │ Intelligence    │      │                          │
│  └──────┬──────┘    └──────┬──────────┘      │                          │
│         │                  │                  │                          │
│         └──────────────────┴──────────────────┘                          │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  Markdown Text  │
                         └────────┬────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        MarkdownChunker                               │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │  1. Preprocess  │ → │  2. Split by    │ → │  3. Enrich with │   │
│  │  & Validate     │   │     Headers     │   │     Metadata    │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   DocumentChunk[]       │
                    │   - content             │
                    │   - embeddingContent    │
                    │   - metadata            │
                    └─────────────────────────┘
```

## Detailed Processing Steps

### Step 1: Preprocess & Validate

```
Input: Raw document string
        │
        ▼
┌───────────────────────────────┐
│   Detect Content Type         │
│   - markdown (# or -)         │
│   - latex (\begin{} or $)     │
│   - plain (default)           │
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│   Estimate Token Count        │
│   ~1.3 tokens per word        │
│   + punctuation adjustment    │
└──────────────┬────────────────┘
               │
               ▼
        ┌──────┴──────┐
        │ Exceeds     │
        │ Safe Limit? │
        └──────┬──────┘
               │
      ┌────────┴────────┐
      │ YES             │ NO
      ▼                 ▼
┌───────────┐   ┌───────────────┐
│ Return    │   │ Continue to   │
│ Empty     │   │ Processing    │
│ + Warning │   └───────────────┘
└───────────┘
```

### Step 2: Split by Headers (Markdown)

For markdown documents, the chunker preserves document structure:

```
Input Markdown:
────────────────────────────────────────────
# Chapter 1
Introduction content here...

## Section 1.1
Section content...

### Subsection 1.1.1
Detailed content...

# Chapter 2
Another chapter...
────────────────────────────────────────────

                    │
                    ▼

Split by Headers:
────────────────────────────────────────────
Section 1:
  content: "# Chapter 1\nIntroduction..."
  headers: { "Header 1": "Chapter 1" }

Section 2:
  content: "## Section 1.1\nSection content..."
  headers: {
    "Header 1": "Chapter 1",
    "Header 2": "Section 1.1"
  }

Section 3:
  content: "### Subsection 1.1.1\nDetailed..."
  headers: {
    "Header 1": "Chapter 1",
    "Header 2": "Section 1.1",
    "Header 3": "Subsection 1.1.1"
  }

Section 4:
  content: "# Chapter 2\nAnother chapter..."
  headers: { "Header 1": "Chapter 2" }
────────────────────────────────────────────
```

### Step 3: Token-Based Secondary Splitting

Large sections are further split while preserving metadata:

```
Large Section (>8191 tokens):
────────────────────────────────────────────
Section content with 20,000 tokens...
metadata: { "Header 1": "Chapter 1" }
────────────────────────────────────────────

                    │
                    ▼

TokenTextSplitter (overlap=400):
────────────────────────────────────────────
Chunk 1:
  content: "First 8191 tokens..."
  metadata: { "Header 1": "Chapter 1" }

Chunk 2:
  content: "...400 overlap + next 8191..."
  metadata: { "Header 1": "Chapter 1" }

Chunk 3:
  content: "...400 overlap + remaining..."
  metadata: { "Header 1": "Chapter 1" }
────────────────────────────────────────────
```

## Metadata Structure

Each chunk carries rich metadata for downstream processing:

```typescript
interface ChunkMetadata {
  headers: {
    "Header 1"?: string;  // e.g., "Introduction"
    "Header 2"?: string;  // e.g., "Background"
    "Header 3"?: string;  // e.g., "Prior Work"
  };
  page?: number;           // Page number from page breaks
  orderInDocument: number; // Sequential order (1, 2, 3...)
  isTable: boolean;        // True if chunk contains markdown table
  fileName?: string;       // Original file name
}
```

## Table Detection

Tables receive special handling for better embedding quality:

```
Input with Table:
────────────────────────────────────────────
# Data Summary

| Name  | Value | Unit |
|-------|-------|------|
| Temp  | 25    | °C   |
| Press | 101   | kPa  |
────────────────────────────────────────────

                    │
                    ▼

Output Chunk:
────────────────────────────────────────────
content: "# Data Summary\n\n| Name | Value..."
embeddingContent: "# Data Summary\n\n| Name..."
metadata: {
  headers: { "Header 1": "Data Summary" },
  isTable: true,    ← Flagged for table-aware processing
  orderInDocument: 1
}
────────────────────────────────────────────
```

## Page Number Tracking

Page breaks in markdown (from PDF conversion) are tracked:

```
Input with Page Breaks:
────────────────────────────────────────────
# Introduction
Content on page 1...

<!-- PageBreak 2 -->

More content on page 2...

<!-- PageBreak 3 -->

Content on page 3...
────────────────────────────────────────────

                    │
                    ▼

Output Chunks:
────────────────────────────────────────────
Chunk 1: { ..., metadata: { page: 1 } }
Chunk 2: { ..., metadata: { page: 2 } }
Chunk 3: { ..., metadata: { page: 3 } }
────────────────────────────────────────────
```

## Usage Examples

### Basic Usage (Backwards Compatible)

```typescript
import { chunkDocumentWithOverlap } from './text-chunk';

const document = "# Title\n\nContent here...";
const chunks: string[] = await chunkDocumentWithOverlap(document);
// Returns: ["# Title\n\nContent here..."]
```

### Enhanced Usage with Metadata

```typescript
import { chunkDocumentWithMetadata, ChunkingResult } from './text-chunk';

const document = `
# Chapter 1
First chapter content.

## Section 1.1
Section content with details.
`;

const result: ChunkingResult = await chunkDocumentWithMetadata(
  document,
  'document.md'
);

// result.chunks[0]:
// {
//   content: "# Chapter 1\nFirst chapter content.",
//   embeddingContent: "# Chapter 1\nFirst chapter content.",
//   metadata: {
//     headers: { "Header 1": "Chapter 1" },
//     page: 1,
//     orderInDocument: 1,
//     isTable: false,
//     fileName: "document.md"
//   }
// }
```

### Custom Configuration

```typescript
import { MarkdownChunker } from './text-chunk';

const chunker = new MarkdownChunker({
  chunkSize: 4096,        // Smaller chunks for faster search
  chunkOverlap: 200,      // Less overlap
  safeTokenLimit: 100000, // Lower limit for safety
  headersToSplit: [
    { level: '#', name: 'Chapter' },
    { level: '##', name: 'Section' },
  ]
});

const result = await chunker.chunkDocument(document, 'report.md');
```

## Integration with Vector Store

The chunked output integrates seamlessly with Azure Cognitive Search:

```
                    ┌─────────────────────────┐
                    │   chunkDocumentWith     │
                    │       Metadata()        │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │   DocumentChunk[]       │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Generate       │   │  Store in       │   │  Build Citation │
│  Embeddings     │   │  Azure Search   │   │  References     │
│  (OpenAI)       │   │  (Vector Store) │   │  (for RAG)      │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

## Best Practices (from sensei-server)

1. **Token Validation**: Always check token count before chunking
2. **Header Preservation**: Maintain document hierarchy in metadata
3. **Table Awareness**: Flag tables for potential special embedding
4. **Page Tracking**: Preserve page numbers for accurate citations
5. **Overlap Strategy**: Use 400-token overlap for context preservation
6. **Safe Limits**: Set upper bounds to prevent memory issues

## Configuration Reference

| Parameter | Default | Description |
|-----------|---------|-------------|
| `chunkSize` | 8191 | Maximum tokens per chunk |
| `chunkOverlap` | 400 | Overlap between adjacent chunks |
| `safeTokenLimit` | 200000 | Maximum document size before rejection |
| `headersToSplit` | H1, H2, H3 | Markdown headers to use as split points |
