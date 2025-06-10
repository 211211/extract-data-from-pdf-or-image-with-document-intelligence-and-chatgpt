<!--
  Documentation for maintenance scripts
  Located at: scripts/
-->
# Scripts

This folder contains CLI scripts to manage the Azure Cognitive Search index outside of the HTTP API. Use these when you need to seed or clear your search index as part of development, CI/CD pipelines, or local maintenance.

## Prerequisites
- Node.js and `ts-node` are installed (project uses TypeScript).  
- Environment variables configured in `.env` (see root `README.md`):
  - `AZURE_SEARCH_SERVICE_NAME`
  - `AZURE_SEARCH_API_KEY`
  - `AZURE_SEARCH_INDEX_NAME` (for clear-index)
- The NestJS application dependencies are installed (`yarn install`).

## Scripts

### 1. seed-index.ts

Seeds sample documents into the Azure Cognitive Search index.

**Usage**:
```bash
# Ensure the search index exists, then seed sample docs
yarn ts-node scripts/seed-index.ts
```

This script performs the following steps:
1. Loads application context via NestJS.
2. Ensures the target Azure Search index is created (`ensureIndexIsCreated`).
3. Calls `SearchService.seed()` to insert sample documents.
4. Closes the application context.

### 2. clear-index.ts

Clears (deletes) all documents from a specified Azure Cognitive Search index. The index schema remains intact.

**Usage**:
```bash
# Clear using the index name from environment variable
yarn ts-node scripts/clear-index.ts

# Or pass the index name as a CLI argument
yarn ts-node scripts/clear-index.ts my-custom-index
```

The script will:
1. Read the index name from the first CLI argument or `AZURE_SEARCH_INDEX_NAME` env var.
2. Initialize NestJS application context.
3. Invoke `SearchService.clear(indexName)` to remove all documents.
4. Close the application context.

## Integration Tips
- You can integrate these scripts into NPM scripts in `package.json` for convenience:
  ```json
  "scripts": {
    "seed-index": "ts-node scripts/seed-index.ts",
    "clear-index": "ts-node scripts/clear-index.ts"
  }
  ```
- Use these scripts in CI/CD jobs to reset or populate indexes before integration tests.