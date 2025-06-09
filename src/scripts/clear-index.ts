#!/usr/bin/env ts-node

import 'dotenv/config';

import { AppModule } from '../app.module';
import { NestFactory } from '@nestjs/core';
import { SearchService } from '../core/public/search/search.service';

async function main() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const searchService = appContext.get(SearchService);
  // Determine index name: first CLI arg or env var
  const [, , indexNameArg] = process.argv;
  const indexName = indexNameArg || process.env.AZURE_SEARCH_INDEX_NAME;
  if (!indexName) {
    console.error('Error: index name must be provided as CLI argument or AZURE_SEARCH_INDEX_NAME env var');
    process.exit(1);
  }
  console.log(`Clearing Azure Search index '${indexName}'...`);
  await searchService.clear(indexName);
  console.log('Index cleared.');
  await appContext.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
