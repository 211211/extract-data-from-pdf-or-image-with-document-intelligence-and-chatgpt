/api/v1/search/simple
{
  "search": "node",
  "count": true,
  "queryType": "simple",
  "queryLanguage": "en-us"
}

/api/v1/search/semantic
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

/api/v1/search/vector
{
  "search": "node",
  "count": true,
  "queryType": "vector",
  "vectorQueries": [
    {
      "kind": "vector",
      "value": "<vector representation of 'node'>",
      "fields": "embedding",
      "k": 50,
      "vectorSearchProfile": "vectorConfig-profile"
    }
  ],
  "queryLanguage": "en-us"
}

/api/v1/search/hybrid (with reranking)
{
  "search": "node",
  "count": true,
  "queryType": "semantic",
  "semanticConfiguration": "default",
  "captions": "extractive",
  "answers": "extractive|count-3",
  "vectorQueries": [
    {
      "kind": "vector",
      "value": "<vector representation of 'node'>",
      "fields": "embedding",
      "k": 50,
      "vectorSearchProfile": "vectorConfig-profile"
    }
  ],
  "queryLanguage": "en-us",
  "queryRewrites": "generative",
  "rerank": true
}