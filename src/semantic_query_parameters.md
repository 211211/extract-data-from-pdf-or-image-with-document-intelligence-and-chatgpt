# Azure Cognitive Search – Semantic Query Parameters Explained

Below is a sample semantic-search request body you can paste into the **Search explorer** (in the Azure Portal) or issue via REST/SDK to your Azure Cognitive Search index:

```json
{
  "search": "node",
  "count": true,
  "queryType": "semantic",
  "semanticConfiguration": "default",
  "captions": "extractive",
  "answers": "extractive|count-3",
  "queryLanguage": "en-us",
  "queryRewrites": "generative"
}
```

---

## How to run this in the Azure Portal

1. Navigate to your **Azure Cognitive Search** resource.
2. In the left menu, click **Search explorer**.
3. Select the target index from the dropdown.
4. Switch to the **Request body** tab (for a POST against `/indexes/{indexName}/docs/search`).
5. Paste the JSON above.
6. Hit **Run** to see documents and semantic answers returned.

---

## Field-by-Field Breakdown

| Parameter                | Type      | Description                                                                                                                                             |
|--------------------------|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| **search**               | string    | The user’s query text.                                                                                                                                 |
| **count**                | boolean   | When `true`, returns the total count of documents matching the query along with the results.                                                            |
| **queryType**            | string    | Either `simple` (keyword search) or `semantic` (leverages semantic ranking and AI features). Here we use `semantic`.                                       |
| **semanticConfiguration**| string    | Name of the **semantic configuration** you have set up on your index (e.g. analyzers, embeddings, knowledge store settings). Commonly `default`.          |
| **captions**             | string    | Enables **extractive summaries** of matching content. Values:                                                                                          |
|                          |           | - `extractive`: Returns the most relevant snippets from the document(s).                                                                                |
|                          |           | - `none`: No captions.                                                                                                                                 |
| **answers**              | string    | Pulls out question-answering style responses from the best-matching docs. You can combine modes with `|`.                                               |
|                          |           | - `extractive`: returns text excerpts.                                                                                                                  |
|                          |           | - `count-3`: also limit to top 3 answers.                                                                                                              |
| **queryLanguage**        | string    | ISO code for the language of the query. Affects language-specific processing (stemming, stop words, etc.). e.g. `en-us`, `fr-fr`, `zh-cn`.               |
| **queryRewrites**        | string    | Enables AI-driven query rewriting.                                                                                                                     |
|                          |           | - `generative`: the service will try to “rephrase” or expand the user’s question.                                                                       |
|                          |           | - `none`: leave the query as-is.                                                                                                                       |

---

## Putting It All Together

- **Semantic ranking** (`queryType=semantic`) boosts the relevance of AI‐interpreted answers over pure keyword matches.
- **Captions** and **answers** unlock extractive Q&A: you get snippets **and** a structured set of answer suggestions.
- **Count** helps you display “Showing X of Y matches” in your UI.
- **Query rewrites** allow the service to clarify or expand the query via AI before searching.

Feel free to tweak:

- `semanticConfiguration` to point at a custom config.
- `answers` (e.g. `extractive|count-5`) to adjust how many answers to pull.
- `queryLanguage` if you support multilingual queries.

For more details, see the official docs:
https://docs.microsoft.com/azure/search/cognitive-search-concept-semantic-overview
https://docs.microsoft.com/azure/search/search-json-rest-api-request-body#index-post-body