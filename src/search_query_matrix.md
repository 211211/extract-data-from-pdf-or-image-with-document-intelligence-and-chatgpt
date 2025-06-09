# Search Query Endpoints Matrix

Replace `http://localhost:3000/api/v1` with your base URL. The table below summarizes the four primary search endpoints exposed by the service:

| Type      | Endpoint                           | Sample Curl                                                                                                    | Description                                                   | Expected Matching Docs                          |
|-----------|------------------------------------|---------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------|
| Simple    | `/search/simple`                   | `curl "{{BASE_URL}}/search/simple?query=node"`                                                              | Exact keyword matching in indexed content                    | Documents containing the literal term “node”     |
| Semantic  | `/search/semantic`                 | `curl "{{BASE_URL}}/search/semantic?query=build%20scalable%20server%20apps&top=5"`                           | AI-driven semantic ranking and extractive summaries          | Related frameworks (e.g. NestJS, Spring Boot)    |
| Vector    | `/search/vector`                   | `curl "{{BASE_URL}}/search/vector?query=numerical%20vectors&k=5"`                                            | Embedding-based similarity search                            | Topics on vector embeddings and related math    |
| Hybrid    | `/search/hybrid`                   | `curl "{{BASE_URL}}/search/hybrid?query=search%20relevance&top=5"`                                          | Combined semantic + vector ranking for balanced relevance   | Results blending semantic & vector strengths     |

### Parameters
- `query` (string): The user’s search text or phrase.  
- `top` (number): Maximum number of results to return (`semantic`, `hybrid`).  
- `k` (number): Number of nearest neighbors to retrieve (`vector`).  
- `filter` (string): Optional OData filter to narrow results.

### Usage Notes
- **Simple** search is fast and lightweight, ideal for exact-term lookups.  
- **Semantic** search leverages natural-language understanding and provides extractive captions/answers.  
- **Vector** search finds semantically similar content via dense embeddings—you must enable and populate vector fields.  
- **Hybrid** search balances semantic richness with vector similarity for more nuanced ranking.

Use the `/search/seed` endpoint to populate your index with sample documents before running queries.
```bash
curl "{{BASE_URL}}/search/seed"
```