import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseFactory } from './database.factory';
import { InMemoryChatRepository } from './repositories/memory.repository';
import { SQLiteChatRepository } from './repositories/sqlite.repository';
import { CosmosDBChatRepository } from './repositories/cosmosdb.repository';

/**
 * Database Module
 *
 * Provides a swappable database abstraction layer.
 * Configure via DATABASE_PROVIDER environment variable.
 *
 * Supported providers:
 * - memory: In-memory storage (default, for development)
 * - sqlite: SQLite file storage (for standalone demos)
 * - cosmosdb: Azure CosmosDB (production recommended)
 * - postgres: PostgreSQL (future)
 * - mongodb: MongoDB (future)
 *
 * The IChatRepository interface allows easy switching between providers
 * without changing application code.
 *
 * @example
 * // In .env for CosmosDB (recommended for production)
 * DATABASE_PROVIDER=cosmosdb
 * AZURE_COSMOSDB_ENDPOINT=https://your-account.documents.azure.com:443/
 * AZURE_COSMOSDB_KEY=your-key
 * AZURE_COSMOSDB_DATABASE=chatdb
 * AZURE_COSMOSDB_CONTAINER=chat
 *
 * @example
 * // In service
 * constructor(@Inject('IChatRepository') private chatRepo: IChatRepository) {}
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    // Individual repository implementations
    InMemoryChatRepository,
    SQLiteChatRepository,

    // CosmosDB repository - conditionally created based on config
    {
      provide: CosmosDBChatRepository,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('DATABASE_PROVIDER', 'memory');
        const endpoint = configService.get<string>('AZURE_COSMOSDB_ENDPOINT');
        const key = configService.get<string>('AZURE_COSMOSDB_KEY');

        // Only instantiate if cosmosdb is selected and credentials are available
        if (provider === 'cosmosdb' && endpoint && key) {
          return new CosmosDBChatRepository(configService);
        }
        return undefined;
      },
      inject: [ConfigService],
    },

    // Factory for creating the right repository
    DatabaseFactory,

    // The actual repository injection token
    {
      provide: 'IChatRepository',
      useFactory: (factory: DatabaseFactory) => factory.getRepository(),
      inject: [DatabaseFactory],
    },
  ],
  exports: ['IChatRepository', DatabaseFactory, InMemoryChatRepository, SQLiteChatRepository, CosmosDBChatRepository],
})
export class DatabaseModule {}
