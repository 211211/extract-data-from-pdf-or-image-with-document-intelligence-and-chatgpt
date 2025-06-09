#!/usr/bin/env ts-node

import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SearchService } from '../core/public/search/search.service';

import { ensureIndexIsCreated } from '../core/public/pdf-extractor/services/azure-cog-vector-store';

async function main() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const searchService = appContext.get(SearchService);
  console.log('Ensuring search index exists...');
  await ensureIndexIsCreated();
  console.log('Seeding sample documents into search index...');
  await searchService.seed();
  console.log('Index seeding complete.');
  await appContext.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
