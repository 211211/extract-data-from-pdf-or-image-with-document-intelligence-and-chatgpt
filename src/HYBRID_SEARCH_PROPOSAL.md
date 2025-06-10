<!--
  Proposal: Switch from Keyword Search to Hybrid Semantic Ranking
  Author: [Your Name]
  Date: YYYY-MM-DD
-->
# Proposal: Hybrid Semantic Ranking with Azure Cognitive Search

## 1. Executive Summary
Traditional keyword search (e.g., BM25) matches exact terms but struggles with synonyms, paraphrases, and concept-based queries. By integrating vector embeddings with lexical retrieval in a **hybrid semantic ranking** pipeline, we can deliver more relevant, context-aware results without sacrificing recall.

## 2. Current State
- **Engine**: Azure Cognitive Search (BM25, inverted index)
- **Limitations**:
  - No handling of semantic similarity
  - Sensitive to stopwords, spelling, and tokenization
  - Poor ranking for conceptually related documents

## 3. Proposed Hybrid Architecture
1. **Indexing (Pre-Stage)**
   - Chunk documents into manageable segments
   - Generate embeddings via Azure/OpenAI embedding model
   - Store embeddings in a vector field alongside text fields
2. **Query-time Retrieval**
   - **Stage 1**: Lexical search (BM25) to fetch top-M candidates
   - **Stage 2**: Semantic scoring by computing cosine similarity between query embedding and candidate embeddings (via ANN index in Azure Search)
   - **Fusion**: Combine scores: `final_score = α * lexical_score + β * semantic_score`
3. **Optional Reranking (Post-Stage)**
   - Apply a cross-encoder or lightweight generative model on top-N results for fine-grained ordering

## 4. Data Flow Diagram
```text
User Query
  ├─> Lexical Search (BM25) → [candidates + lexical_score]
  ├─> Embed(Query)       → query_vector
  └─> Semantic Search     → [candidates + semantic_score]
       └─> Score Fusion → Final ranking
```

## 5. Configuration and Implementation
| Component            | Location / Config                                  |
|----------------------|----------------------------------------------------|
| Embedding Model      | `providers/embedding.provider.ts`                  |
| Chunking Logic       | `services/text-chunk.ts`                           |
| Search Service       | `search/search.service.ts`                         |
| Fusion Weights       | Env vars: `LEXICAL_WEIGHT`, `SEMANTIC_WEIGHT`      |
| Azure Index Settings | Vector field in Azure portal or ARM template       |

## 6. Pros and Cons
**Pros**
- Handles synonyms and paraphrases naturally
- Balances recall (lexical) with precision (semantic)
- Modern search UX aligned with industry best practices

**Cons**
- Additional cost for embedding API calls
- Increased complexity: managing embeddings and ANN index
- Potential latency impact at query time due to multi-stage processing

## 7. Cost and Pricing Model
- **Azure Cognitive Search**
  - **Vector Storage**: ~$Z per GB/month
  - **Queries**: Semantic query units billed per 1,000 queries
- **Embedding API (OpenAI/Azure)**
  - Charged per 1,000 tokens processed (e.g., $0.0004 per 1K tokens)
  - Bulk batching can reduce per-call overhead
- **Compute & Infrastructure**
  - ANN index runs within the chosen Azure Search tier at no extra compute cost beyond the service SKU

## 8. Migration Plan
1. **Proof of Concept** (1 week)
   - Prototype on a sample dataset, measure relevance improvements
2. **Pilot Rollout** (2–4 weeks)
   - Re-index full dataset, expose hybrid endpoint, A/B test vs. keyword search
3. **Production Launch**
   - Swap default search route to hybrid, monitor metrics
   - Fine-tune weights and reranker as needed

## 9. Conclusion
Implementing hybrid semantic ranking in Azure Cognitive Search will significantly enhance search relevance and user satisfaction. While it introduces moderate cost and complexity, the long-term benefits in retention and task success justify the investment.