#!/usr/bin/env ts-node
/**
 * Azure Search Index Setup Script
 *
 * Creates the Azure Search index if it doesn't exist.
 * Optionally seeds with sample documents for testing.
 *
 * Usage:
 *   yarn setup:search              # Create index only
 *   yarn setup:search --seed       # Create index and seed sample data
 *   yarn setup:search --reset      # Delete and recreate index
 *   yarn setup:search --status     # Check index status only
 */

import 'dotenv/config';

import {
  ensureIndexIsCreated,
  getAllDocuments,
  resetIndex,
} from '../core/public/pdf-extractor/services/azure-cog-vector-store';

import { AppModule } from '../app.module';
import { AzureAISearchIndexClientInstance } from '../core/public/pdf-extractor/services/ai-search';
import { NestFactory } from '@nestjs/core';
import { SearchService } from '../core/public/search/search.service';

// Parse CLI arguments
const args = process.argv.slice(2);
const shouldSeed = args.includes('--seed');
const shouldReset = args.includes('--reset');
const statusOnly = args.includes('--status');
const showHelp = args.includes('--help') || args.includes('-h');

function printUsage() {
  console.log(`
Azure Search Index Setup Script

Usage:
  yarn setup:search [options]

Options:
  --status    Check index status only (no modifications)
  --seed      Create index and seed with sample documents
  --reset     Delete and recreate the index (WARNING: deletes all data)
  --help, -h  Show this help message

Environment Variables Required:
  AZURE_SEARCH_NAME           Azure Search service name
  AZURE_SEARCH_API_KEY        Azure Search API key
  AZURE_SEARCH_INDEX_NAME     Name of the index to create/manage
  AZURE_SEARCH_API_VERSION    API version (e.g., 2024-07-01)

Examples:
  yarn setup:search              # Create index if not exists
  yarn setup:search --status     # Check current index status
  yarn setup:search --seed       # Create index and add sample docs
  yarn setup:search --reset      # Reset index (deletes all data)
`);
}

async function checkIndexStatus(): Promise<{ exists: boolean; documentCount: number }> {
  try {
    const client = AzureAISearchIndexClientInstance();
    const indexName = process.env.AZURE_SEARCH_INDEX_NAME!;

    // Try to get the index
    await client.getIndex(indexName);

    // If we get here, index exists - count documents
    const docs = await getAllDocuments(indexName);
    return { exists: true, documentCount: docs.length };
  } catch (error: any) {
    if (error.statusCode === 404 || error.code === 'ResourceNotFound') {
      return { exists: false, documentCount: 0 };
    }
    throw error;
  }
}

function validateEnvironment(): boolean {
  const required = ['AZURE_SEARCH_NAME', 'AZURE_SEARCH_API_KEY', 'AZURE_SEARCH_INDEX_NAME'];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\nPlease set these in your .env file');
    return false;
  }

  return true;
}

async function main() {
  if (showHelp) {
    printUsage();
    process.exit(0);
  }

  console.log('\n🔍 Azure Search Index Setup');
  console.log('═'.repeat(50));

  // Validate environment
  if (!validateEnvironment()) {
    process.exit(1);
  }

  const indexName = process.env.AZURE_SEARCH_INDEX_NAME!;
  const searchName = process.env.AZURE_SEARCH_NAME!;

  console.log(`📍 Search Service: ${searchName}`);
  console.log(`📋 Index Name:     ${indexName}`);
  console.log('═'.repeat(50));

  // Check current status
  console.log('\n📊 Checking index status...');
  let status: { exists: boolean; documentCount: number };

  try {
    status = await checkIndexStatus();
  } catch (error: any) {
    console.error(`❌ Failed to check index status: ${error.message}`);
    process.exit(1);
  }

  if (status.exists) {
    console.log(`✅ Index exists with ${status.documentCount} documents`);
  } else {
    console.log('⚠️  Index does not exist');
  }

  // Status only mode - exit here
  if (statusOnly) {
    console.log('\n✅ Status check complete');
    process.exit(0);
  }

  // Reset mode
  if (shouldReset) {
    console.log('\n🔄 Resetting index (delete and recreate)...');
    try {
      await resetIndex();
      console.log('✅ Index reset complete');
      status = { exists: true, documentCount: 0 };
    } catch (error: any) {
      console.error(`❌ Failed to reset index: ${error.message}`);
      process.exit(1);
    }
  }

  // Create index if not exists
  if (!status.exists && !shouldReset) {
    console.log('\n📝 Creating index...');
    try {
      await ensureIndexIsCreated();
      console.log('✅ Index created successfully');
    } catch (error: any) {
      console.error(`❌ Failed to create index: ${error.message}`);
      process.exit(1);
    }
  }

  // Seed mode
  if (shouldSeed) {
    console.log('\n🌱 Seeding sample documents...');
    try {
      const appContext = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn'],
      });
      const searchService = appContext.get(SearchService);
      await searchService.seed();
      await appContext.close();

      // Re-check status
      const newStatus = await checkIndexStatus();
      console.log(`✅ Seeding complete - index now has ${newStatus.documentCount} documents`);
    } catch (error: any) {
      console.error(`❌ Failed to seed index: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log('✅ Setup complete!');
  console.log('═'.repeat(50) + '\n');
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message || err);
  process.exit(1);
});
