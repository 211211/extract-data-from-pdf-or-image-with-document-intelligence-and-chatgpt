<!--
  Documentation for the Search Module
  Located at: core/public/search
-->
# Search Module Documentation

This module exposes REST APIs for semantic, vector, hybrid, and keyword-based search using Azure Cognitive Search, plus indexing operations.

## Environment Variables
The service requires the following environment variables configured (in `.env`):

```dotenv
AZURE_SEARCH_SERVICE_NAME=<your-search-service-name>
AZURE_SEARCH_API_KEY=<your-search-api-key>
AZURE_SEARCH_INDEX_NAME=<your-search-index-name>
```  

## Controller: SearchController
Base path: `/search`

### Endpoints

#### 1. GET /search/semantic
- Description: Perform semantic search (using AI-powered ranking)  
- Query parameters:
  - `query` (string, required) — search terms
  - `top` (number, optional) — max results to return
  - `filter` (string, optional) — Azure Search filter syntax
- Response: `200 OK`, array of `DocumentDto`

#### 2. GET /search/vector
- Description: Perform vector similarity search (embedding-based)  
- Query parameters:
  - `query` (string, required)
  - `k` (number, optional) — number of nearest neighbors
  - `filter` (string, optional)
- Response: `200 OK`, array of `DocumentDto`

#### 3. GET /search/hybrid
- Description: Combine semantic and vector ranking  
- Query parameters:
  - `query` (string, required)
  - `top` (number, optional)
  - `filter` (string, optional)
- Response: `200 OK`, array of `DocumentDto`

#### 4. GET /search/simple
- Description: Basic keyword search  
- Query parameters:
  - `query` (string, optional)
  - `filter` (string, optional)
- Response: `200 OK`, array of `DocumentDto`

#### 5. GET /search/seed
- Description: Seed a set of sample documents into the index  
- Response: `200 OK`, `{ success: true }`

#### 6. POST /search/index
- Description: Index an arbitrary array of documents  
- Request body: JSON array of `DocumentDto` objects  
- Response: `200 OK`, `{ success: true }`

#### 7. POST /search/index-folder
- Description: Read all PDFs under a local folder, extract text, and index  
- Request body:
  ```json
  {
    "folderPath": "<local-path-to-folder>",
    "user": "<username>",
    "chatThreadId": "<thread-id>"
  }
  ```
- Response: `200 OK`, array of `DocumentDto`

#### 8. GET /search/clear
- Description: Delete all documents from the specified index (schema intact)  
- Query parameters:
  - `indexName` (string, optional) — defaults to env `AZURE_SEARCH_INDEX_NAME`
- Response: `200 OK`, `{ success: true }`

#### 9. GET /search/documents
- Description: Retrieve all documents from the specified index  
- Query parameters:
  - `indexName` (string, optional)
- Response: `200 OK`, array of `DocumentDto`

## Data Transfer Object: DocumentDto
Defined in `dto/document.dto.ts`:
```ts
export class DocumentDto {
  id: string;
  pageContent: string;
  embedding?: number[];
  user: string;
  chatThreadId: string;
  metadata: string;
}
```

## Services

### SearchService
- Implements all search methods:
  - `semanticSearch(query: string, top?: number, filter?: string): Promise<DocumentDto[]>`
  - `vectorSearch(query: string, k?: number, filter?: string): Promise<DocumentDto[]>`
  - `hybridSearch(query: string, top?: number, filter?: string): Promise<DocumentDto[]>`
  - `simpleSearch(query?: string, filter?: string): Promise<DocumentDto[]>`
  - `seed(): Promise<void>`
  - `index(docs: DocumentDto[]): Promise<void>`
  - `clear(indexName?: string): Promise<void>`
  - `getAllDocuments(indexName?: string): Promise<DocumentDto[]>`

### IndexerService
- `indexFolder(folderPath: string, user: string, chatThreadId: string): Promise<DocumentDto[]>`  
- Reads PDFs/images from `folderPath`, extracts text, and indexes into Azure Cognitive Search.

## Usage Examples

```bash
# Semantic search
curl "http://localhost:3000/search/semantic?query=climate&top=5"

# Index a document array
curl -X POST "http://localhost:3000/search/index" \
  -H 'Content-Type: application/json' \
  -d '[{ "id":"1", "pageContent":"Hello world", "user":"a", "chatThreadId":"t1", "metadata":"meta" }]'

# Clear index
curl "http://localhost:3000/search/clear"
```

## Swagger
All endpoints are documented in Swagger UI at `/swaggers`.

## Key Concepts

### Embedding Field
An *embedding* is a dense, fixed-length numeric vector that encodes the semantic content of a piece of text—such as a sentence, paragraph, or full document—into a continuous vector space. Modern transformer-based models (e.g., OpenAI embeddings, Azure ML embeddings) learn to place semantically similar texts close together in this space.

Key properties:
- **Dimensionality**: Commonly 256, 512, 768 dimensions or higher. Each dimension captures latent semantic features.
- **Normalization**: Embeddings may be L2-normalized, enabling cosine similarity via simple dot products.
- **Pre-training**: Models are trained on massive text corpora with contrastive or masked-language objectives to capture broad linguistic patterns.

Use cases in this module:
- **Vector Search**: Compute the cosine or Euclidean distance between a query embedding and document embeddings to retrieve nearest neighbors.
- **Re-ranking**: After initial candidate retrieval (keyword or semantic), use embeddings to refine ranking based on semantic closeness.
- **Hybrid Fusion**: Blend lexical scores (e.g., BM25) and vector distances into a single relevance metric.

Implementation notes:
- Store embeddings alongside documents in Azure Cognitive Search as a vector field.  
- Use an approximate nearest neighbor (ANN) index structure (e.g., HNSW) for sub-linear lookup at scale.

### Tokenization and Tokens
Tokenization is the procedure that transforms raw text into discrete *tokens* that a language model’s vocabulary recognizes. State-of-the-art tokenizers use subword algorithms (e.g., Byte Pair Encoding, WordPiece, SentencePiece) to balance vocabulary size and out-of-vocabulary handling.

Token types:
- **WordPiece/BPE Subwords**: Breaks rare words into common subword units (e.g., `un`, `##predict`, `##able`).  
- **Graphemes or Characters**: In some models (e.g., GPT-2), infrequent Unicode characters may be single tokens.
- **Control Tokens**: Special markers for padding, beginning/end of sequence, or language identifiers.

Why tokenization matters:
- **Context Window**: Models have a finite maximum tokens per request (e.g., 4k-32k tokens). Oversized inputs must be chunked or truncated.
- **Cost and Latency**: API billing often counts input + output tokens. More tokens → higher cost & slower turnaround.
- **Semantic Coherence**: Chunking around token boundaries prevents cutting semantics in half.

Best practices:
- Pre-chunk large documents by complete sentences or paragraphs to respect model input limits.  
- Monitor average tokens per document to estimate storage and billing impacts.  
- Use the same tokenizer (and model) for both query and document embedding generation to ensure alignment.

### Semantic Search
Semantic search transcends simple keyword matching by representing queries and documents in a continuous vector space and measuring their *semantic proximity*. The typical pipeline:

1. **Embedding Generation**
   - **Query Encoder**: Pass the user’s query text through a pretrained embedding model to obtain a query vector.
   - **Document Encoder**: Pre-compute document embeddings offline and store them in the search index.
2. **Approximate Nearest Neighbor (ANN) Retrieval**
   - Use an ANN index (e.g., HNSW, IVFPQ) to efficiently retrieve the top-k documents whose embeddings minimize a distance metric (commonly cosine similarity).
3. **AI-Powered Reranking (optional)**
   - For the top N candidates (e.g., N=100), perform a cross-encoder or generative reranking step that consumes the full text and query, producing refined relevance scores.
4. **Response Aggregation**
   - Return the final sorted list of `DocumentDto` objects with metadata and similarity scores.

Advantages:
- **Contextual Matching**: Captures synonyms and paraphrases by vector proximity.
- **Robust to Vocabulary Gaps**: Even if the query uses different words, semantics can align.
- **Scalable**: ANN libraries handle millions of vectors with sub-second latency.

### Hybrid Search
Hybrid search integrates the precision of AI embeddings with the breadth of lexical retrieval to yield both high recall and high precision.

Common architectures:

1. **Score Fusion**  
   - Execute a lexical search (e.g., BM25, TF-IDF) to retrieve top-M candidates and record their keyword scores.
   - Compute embedding distances for the same query and candidate set.
   - Normalize and combine scores: `final_score = α * keyword_score + β * semantic_score`, where α, β ∈ [0,1].
2. **Recall Boosting**  
   - Merge hits from independent lexical and vector searches (union), then re-rank by a combined metric.
3. **Multi-Stage Retrieval**  
   - Stage 1: Broad lexical or semantic ANN to get N rough candidates.  
   - Stage 2: Cross-encoder reranker for top 50 documents, using full text and query in context.

Benefits:
- **Enhanced Recall**: Lexical search catches exact keyword matches; vector search captures latent semantics.
- **Improved Precision**: Combined ranking filters out false positives that either method alone might include.
- **Tunable Tradeoff**: Weighting parameters let you shift emphasis between keyword matches and semantic relevance.

Implementation tips:
- Ensure *consistent tokenization* across embedding and term indexes to avoid mismatches.
- Align score ranges (e.g., normalize BM25 scores to [0,1]) before fusion.  
- Monitor performance: multi-stage requiring reranking adds compute but can drastically improve quality.