import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IChatRepository, DatabaseProvider } from './types';
import { InMemoryChatRepository } from './repositories/memory.repository';
import { SQLiteChatRepository } from './repositories/sqlite.repository';
import { CosmosDBChatRepository } from './repositories/cosmosdb.repository';

/**
 * Database Factory
 *
 * Creates the appropriate repository based on configuration.
 * Supports easy switching between database providers via environment variables.
 *
 * Usage:
 *   DATABASE_PROVIDER=memory   # In-memory (default, for development)
 *   DATABASE_PROVIDER=sqlite   # SQLite file (for standalone demos)
 *   DATABASE_PROVIDER=cosmosdb # Azure CosmosDB (production)
 *   DATABASE_PROVIDER=postgres # PostgreSQL (future)
 */
@Injectable()
export class DatabaseFactory {
  private repository: IChatRepository | null = null;

  constructor(
    private configService: ConfigService,
    private memoryRepository: InMemoryChatRepository,
    private sqliteRepository: SQLiteChatRepository,
    @Optional() private cosmosdbRepository?: CosmosDBChatRepository,
  ) {}

  /**
   * Get the configured repository instance
   */
  getRepository(): IChatRepository {
    if (this.repository) {
      return this.repository;
    }

    const provider = this.configService.get<DatabaseProvider>('DATABASE_PROVIDER', 'memory');

    switch (provider) {
      case 'sqlite':
        this.repository = this.sqliteRepository;
        console.log('Using SQLite database provider');
        break;

      case 'cosmosdb':
        if (!this.cosmosdbRepository) {
          throw new Error('CosmosDB provider not available. Check AZURE_COSMOSDB_ENDPOINT and AZURE_COSMOSDB_KEY');
        }
        this.repository = this.cosmosdbRepository;
        console.log('Using Azure CosmosDB database provider');
        break;

      case 'postgres':
        // Future: PostgreSQL implementation
        throw new Error('PostgreSQL provider not yet implemented. Use DATABASE_PROVIDER=memory, sqlite, or cosmosdb');

      case 'mongodb':
        // Future: MongoDB implementation
        throw new Error('MongoDB provider not yet implemented. Use DATABASE_PROVIDER=memory, sqlite, or cosmosdb');

      case 'memory':
      default:
        this.repository = this.memoryRepository;
        console.log('Using in-memory database provider');
        break;
    }

    return this.repository;
  }

  /**
   * Get the current provider type
   */
  getProviderType(): DatabaseProvider {
    return this.configService.get<DatabaseProvider>('DATABASE_PROVIDER', 'memory');
  }
}
