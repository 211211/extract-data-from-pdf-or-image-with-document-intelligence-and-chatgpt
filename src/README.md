# extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt

An example NestJS application demonstrating how to extract text from PDF or image files using Azure Document Intelligence (or OpenAI), post-process the results with ChatGPT, and provide semantic search via Azure Cognitive Search.

The flow should be:

The main flow:
1. User uploads a PDF or image file (e.g. via multipart form).
2. POST request to `/pdf-extractor` (or prefixed with `APP_BASE_PATH`, see environment variable).
3. The server calls Azure Document Intelligence (or OpenAI) to extract raw text/structure. See `core/public/pdf-extractor/pdf-extractor.service.ts`.
4. Post-process the extracted text with ChatGPT using a predefined prompt template in `core/public/pdf-extractor/prompt.ts`.
5. Receive a structured JSON response, for example:

```
[
  {
    "biomarker_name": "MPV",
    "biomarker_value": "9",
    "unit": "NA",
    "reference_range": "9.00 -13 .00",
    "category": "Hematology"
  }
]
```

> Note: Place any sample PDF/image files locally and upload them via your client or CURL. There is no built-in `sample/` directory.

## Environment Variables
Create a `.env` file in the project root and set the following variables:
```dotenv
# Application settings
APP_NAME=extractor-app
APP_VERSION=1.0.0
APP_HOST=localhost
APP_PORT=3000
APP_BASE_PATH=/api/v1        # optional, e.g. "/api/v1"

# Azure Document Intelligence (AI-Document)
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=<your-endpoint>
AZURE_DOCUMENT_INTELLIGENCE_KEY=<your-key>

# OpenAI (optional, if using OpenAI instead of Azure)
OPENAI_API_KEY=<your-openai-key>

# Azure Cognitive Search (for the search module)
AZURE_SEARCH_SERVICE_NAME=<your-search-service>
AZURE_SEARCH_API_KEY=<your-search-api-key>
AZURE_SEARCH_INDEX_NAME=<your-search-index>
```
If you prefer the OpenAI hosted API instead of Azure, set `OPENAI_API_KEY` and in `core/public/pdf-extractor/pdf-extractor.module.ts` replace `AzureOpenAIInstance` with `OpenAIInstance`.


## Dependencies installation

```bash
yarn install
```

## Running the app

```bash
# development (with hot reload)
yarn start:dev

# build + production
yarn build
yarn start:prod
```

## How to test
## API Endpoints

### PDF/Document Extraction
POST `{BASE_PATH}/pdf-extractor`
Content-Type: multipart/form-data
```bash
curl -X POST "http://localhost:3000${APP_BASE_PATH:-/}/pdf-extractor" \
  -F file=@"/path/to/your/sample.pdf"
```

### Semantic Search (Azure Cognitive Search)
GET `{BASE_PATH}/search/semantic?query=<terms>&top=<n>&filter=<filter>`

### Vector Search
GET `{BASE_PATH}/search/vector?query=<terms>&k=<n>&filter=<filter>`

### Hybrid Search
GET `{BASE_PATH}/search/hybrid?query=<terms>&top=<n>&filter=<filter>`

### Simple (Keyword) Search
GET `{BASE_PATH}/search/simple?query=<terms>&filter=<filter>`

### Other Search Operations
- Seed sample docs: GET `{BASE_PATH}/search/seed`
- Index docs: POST `{BASE_PATH}/search/index` (body: JSON array of documents)
- Index folder: POST `{BASE_PATH}/search/index-folder` (body: `{ folderPath, user, chatThreadId }`)
- Clear index: GET `{BASE_PATH}/search/clear?indexName=<name>`
- List documents: GET `{BASE_PATH}/search/documents?indexName=<name>`

## API Documentation
Swagger UI is available at `/swaggers` when the server is running.

## License

MIT
