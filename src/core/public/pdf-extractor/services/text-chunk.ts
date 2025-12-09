/**
 * Text chunking utilities for document processing
 *
 * This module provides backwards-compatible exports from the enhanced
 * markdown-chunker module. For new code, prefer using the enhanced API
 * from markdown-chunker.ts directly.
 *
 * @module text-chunk
 * @see markdown-chunker.ts for the enhanced implementation
 */

// Re-export the legacy function for backwards compatibility
export { chunkDocumentWithOverlap } from './markdown-chunker';

// Also export the enhanced API for new code
export {
  MarkdownChunker,
  chunkDocumentWithMetadata,
  type ChunkerConfig,
  type ChunkMetadata,
  type DocumentChunk,
  type ChunkingResult,
} from './markdown-chunker';
