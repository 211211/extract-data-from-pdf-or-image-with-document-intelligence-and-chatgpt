<!--
  Alternative Search Configurations and Algorithms
  Located at: core/public/search/ALTERNATIVES.md
-->
# Alternative Search Architectures and Configuration Guide

This document covers different search algorithms, embedding models, chunking strategies, and indexing backends you can substitute for Azure Cognitive Search and the default settings in this module.

## 1. Embedding Model Choices
- **OpenAI Embeddings** (e.g., `text-embedding-ada-002`)
  - Dimension: 1536
  - Pros: High quality, maintained by OpenAI
  - Cons: API cost, data sent to OpenAI servers
- **Azure OpenAI Embeddings**
  - Same models via Azure endpoints
  - Pros: Enterprise compliance, Azure network integration
  - Cons: Requires Azure subscription
- **Local / Open Source**
  - Examples: Sentence-BERT, LaBSE, Cohere Embeddings
  - Pros: Control over data, no per-call cost
  - Cons: Self-hosting overhead, resource requirements

### Embedding Config Properties
- `modelName` or `modelId` (string)
- `dimension` (number)
- `endpoint` (URL) / `apiKey` (string)
- `normalize` (boolean) — L2 normalization
- `batchSize` (number) — for bulk embed calls

## 2. Chunking Strategies
Splitting long documents into chunks affects retrieval quality.
- **Fixed-size sliding window**
  - Overlap: e.g., window 1000 tokens with 200-token overlap
  - Pros: Uniform chunks, context windows respected
  - Cons: May split sentences
- **Sentence / Paragraph boundary**
  - Chunk by natural language units
  - Pros: Coherent text segments
  - Cons: Variable length, risk of too-long chunks
- **Hierarchical chunking**
  - Large→medium→small (section→paragraph→sentence)
  - Pros: Maintains document hierarchy
  - Cons: Complex implementation

### Chunking Config Properties
- `chunkSize` (number of tokens or characters)
- `chunkOverlap` (number of tokens)
- `unit`: `'token' | 'sentence' | 'paragraph'`
- `maxChunkTokens` (to enforce model limits)

## 3. Indexing and Storage Backends

| Backend                        | Type            | Pros                               | Cons                             |
|--------------------------------|-----------------|------------------------------------|----------------------------------|
| Azure Cognitive Search         | Managed Cloud   | Vector + lexical + hybrid support | Azure lock-in, cost              |
| Elasticsearch / OpenSearch     | On-premise/Cloud| Mature, inverted index             | kNN support via plugin           |
| Pinecone                       | Vector DB as a Service | High-performance ANN            | Vendor lock-in, cost             |
| Weaviate                       | Vector DB       | Schema + vector search integrated  | Newer ecosystem                  |
| Milvus / Qdrant                | Vector DB       | Open source, self-hosted           | Ops overhead                     |

### Index Config Properties
- `indexName` (string)
- `vectorFieldName` (string)
- `vectorDimension` (number)
- `distanceMetric` (`'cosine' | 'euclidean' | 'dot'`)
- `replicas` / `shards` (for scaling)
- `analyzer` / `tokenizer` (for lexical fields)

## 4. ANN Algorithm Options

| Algorithm   | Description                                    | Pros                                               | Cons                                                |
|-------------|------------------------------------------------|----------------------------------------------------|-----------------------------------------------------|
| HNSW        | Hierarchical Navigable Small World graph index | · Sub-millisecond query latency<br>· High recall (>95%)<br>· Supports dynamic inserts/deletes | · Higher memory footprint (graph storage)<br>· Parameter tuning required (M, efSearch/efConstruction) |
| IVF-PQ      | Inverted File with Product Quantization        | · Low memory usage (quantized vectors)<br>· Fast query throughput | · Approximate results with lower recall<br>· Requires offline codebook training |
| FAISS GPU   | GPU-accelerated FAISS index (e.g., IVF+HNSW)    | · Ultra-low latency (<1ms)<br>· Scales to billions of vectors on GPU | · Dependent on specialized GPU hardware<br>· Higher infrastructure cost |
| Brute-force | Exact nearest neighbor search (linear scan)    | · 100% precision and recall<br>· Simple implementation (no index) | · Unscalable for large datasets<br>· Very high compute & memory cost |

### ANN Config Properties
- `algorithm` (`'hnsw' | 'ivf_pq' | 'brute' | 'faiss_gpu'`)
- `M` / `efConstruction` (HNSW parameters)
- `nlist` / `nprobe` (IVF parameters)
- `useGpu` (boolean)

## 5. Lexical Search Algorithms
- **BM25**
  Probabilistic retrieval model using term frequency (tf), inverse document frequency (idf), and document length normalization.
  - **Pros**: High precision ranking; widely adopted in IR systems; effective for exact keyword queries.
  - **Cons**: No semantic understanding; limited recall for synonyms or paraphrases.
- **TF-IDF**
  Classic vector-space model using tf-idf weights and cosine similarity.
  - **Pros**: Easy implementation; low computational overhead; transparent scoring.
  - **Cons**: Less effective ranking compared to BM25; no document length normalization by default.
- **Boolean / Regex**
  Exact matching using boolean operators (AND/OR/NOT) or regular expressions.
  - **Pros**: Deterministic results; minimal resource usage; precise control over matching.
  - **Cons**: No ranking capability; poor recall for partial or fuzzy matches; can be complex to author.

### Lexical Config Properties
- `type`: `'bm25' | 'tfidf' | 'boolean'`
- `k1`, `b` (BM25 hyperparameters)
- `analyzer`: `'standard' | 'english' | custom`

## 6. Hybrid Configuration Recommendations
1. **Simple score fusion**
   - Weights: `alpha` for lexical, `beta` for semantic.  
   - Normalize scores to common scale.
2. **Multi-stage**
   - Stage 1: Lexical top-`M` (e.g., 1000), ANN top-`k` (e.g., 100)
   - Stage 2: Union or intersection, then rerank with cross-encoder.

### Hybrid Config Properties
- `alpha`, `beta` (number, sum to 1)
- `lexicalTopM`, `annTopK` (numbers)
- `rerankModel` (string, optional)

---
This guide helps you swap components and tune performance, relevance, and cost to your needs. For code examples of integrating alternative providers, see the `*Provider` files under `providers/`.