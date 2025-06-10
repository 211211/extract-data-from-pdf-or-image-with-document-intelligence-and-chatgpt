import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBody } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { IndexerService } from './indexer.service';
import { DocumentDto } from './dto/document.dto';

@Controller('search')
@ApiTags('search')
export class SearchController {
  constructor(private readonly searchService: SearchService, private readonly indexerService: IndexerService) {}

  @Get('semantic')
  @ApiOperation({ summary: 'Semantic search' })
  @ApiResponse({ status: 200, description: 'Semantic search results', type: [DocumentDto] })
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'top', required: false, type: Number })
  @ApiQuery({ name: 'filter', required: false })
  async semantic(
    @Query('query') query: string,
    @Query('top') top?: number,
    @Query('filter') filter?: string,
  ): Promise<DocumentDto[]> {
    return this.searchService.semanticSearch(query, top, filter);
  }

  @Get('vector')
  @ApiOperation({ summary: 'Vector search' })
  @ApiResponse({ status: 200, description: 'Vector search results', type: [DocumentDto] })
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'k', required: false, type: Number })
  @ApiQuery({ name: 'filter', required: false })
  async vector(
    @Query('query') query: string,
    @Query('k') k?: number,
    @Query('filter') filter?: string,
  ): Promise<DocumentDto[]> {
    return this.searchService.vectorSearch(query, k, filter);
  }

  @Get('hybrid')
  @ApiOperation({ summary: 'Hybrid search' })
  @ApiResponse({ status: 200, description: 'Hybrid search results', type: [DocumentDto] })
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'top', required: false, type: Number })
  @ApiQuery({ name: 'filter', required: false })
  async hybrid(
    @Query('query') query: string,
    @Query('top') top?: number,
    @Query('filter') filter?: string,
  ): Promise<DocumentDto[]> {
    return this.searchService.hybridSearch(query, top, filter);
  }
  /**
   * Simple term/keyword based search.
   */
  @Get('simple')
  @ApiOperation({ summary: 'Simple term/keyword search' })
  @ApiResponse({ status: 200, description: 'Keyword search results', type: [DocumentDto] })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'filter', required: false })
  async simple(@Query('query') query?: string, @Query('filter') filter?: string): Promise<DocumentDto[]> {
    return this.searchService.simpleSearch(query, filter);
  }
  /**
   * Seed sample documents into the index.
   */
  @Get('seed')
  @ApiOperation({ summary: 'Seed sample documents into the index' })
  @ApiResponse({
    status: 200,
    description: 'Seed completed',
    schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } },
  })
  async seed(): Promise<{ success: true }> {
    await this.searchService.seed();
    return { success: true };
  }
  /**
   * Index arbitrary documents.
   */
  @Post('index')
  @ApiOperation({ summary: 'Index provided documents' })
  @ApiBody({ description: 'Array of documents to index', type: [DocumentDto] })
  @ApiResponse({
    status: 200,
    description: 'Indexing completed',
    schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } },
  })
  async index(@Body() documents: DocumentDto[]): Promise<{ success: true }> {
    await this.searchService.index(documents as any);
    return { success: true };
  }
  /**
   * Read a local folder of PDFs, extract and index them.
   */
  @Post('index-folder')
  @ApiOperation({ summary: 'Extract and index all PDFs in a folder' })
  @ApiBody({
    description: 'Folder path and metadata',
    schema: {
      type: 'object',
      properties: { folderPath: { type: 'string' }, user: { type: 'string' }, chatThreadId: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Indexed documents from folder', type: [DocumentDto] })
  async indexFolder(
    @Body('folderPath') folderPath: string,
    @Body('user') user: string,
    @Body('chatThreadId') chatThreadId: string,
  ): Promise<DocumentDto[]> {
    const docs = await this.indexerService.indexFolder(folderPath, user, chatThreadId);
    return docs as any;
  }
  /**
   * Clear all documents from the specified Azure Search index (leaves index schema intact).
   */
  @Get('clear')
  @ApiOperation({ summary: 'Clear all documents from the specified index' })
  @ApiResponse({
    status: 200,
    description: 'Clear index completed',
    schema: { type: 'object', properties: { success: { type: 'boolean', example: true } } },
  })
  @ApiQuery({
    name: 'indexName',
    required: false,
    description: 'Azure Search index name; defaults to env AZURE_SEARCH_INDEX_NAME',
  })
  async clear(@Query('indexName') indexName?: string): Promise<{ success: true }> {
    await this.searchService.clear(indexName);
    return { success: true };
  }
  /**
   * Retrieve all documents from the specified Azure Search index.
   */
  @Get('documents')
  @ApiOperation({ summary: 'Retrieve all documents from the specified index' })
  @ApiResponse({ status: 200, description: 'Retrieved documents', type: [DocumentDto] })
  @ApiQuery({
    name: 'indexName',
    required: false,
    description: 'Azure Search index name; defaults to env AZURE_SEARCH_INDEX_NAME',
  })
  async getAllDocuments(@Query('indexName') indexName?: string): Promise<DocumentDto[]> {
    return this.searchService.getAllDocuments(indexName);
  }
}
