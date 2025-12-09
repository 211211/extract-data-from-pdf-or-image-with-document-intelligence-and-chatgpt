import {
  LatexTextSplitter,
  MarkdownTextSplitter,
  RecursiveCharacterTextSplitter,
  TokenTextSplitter,
} from '@langchain/textsplitters';

/**
 * Configuration for the markdown chunker
 */
export interface ChunkerConfig {
  /** Maximum tokens per chunk (default: 8191, compatible with most embedding models) */
  chunkSize: number;
  /** Overlap between chunks to preserve context (default: 400) */
  chunkOverlap: number;
  /** Maximum safe token count before requiring manual processing (default: 200000) */
  safeTokenLimit: number;
  /** Headers to split on for markdown documents */
  headersToSplit: Array<{ level: string; name: string }>;
}

/**
 * Metadata extracted from document headers
 */
export interface ChunkMetadata {
  /** Header hierarchy extracted from markdown */
  headers: Record<string, string>;
  /** Page number if available */
  page?: number;
  /** Order of this chunk in the original document */
  orderInDocument: number;
  /** Whether this chunk contains a table */
  isTable: boolean;
  /** Original file name if provided */
  fileName?: string;
}

/**
 * A chunk of document with content and metadata
 */
export interface DocumentChunk {
  /** The actual text content of the chunk */
  content: string;
  /** Content optimized for embedding (may differ for tables) */
  embeddingContent: string;
  /** Metadata about this chunk */
  metadata: ChunkMetadata;
}

/**
 * Result of chunking operation
 */
export interface ChunkingResult {
  /** The document chunks */
  chunks: DocumentChunk[];
  /** Total token count of the document */
  totalTokens: number;
  /** Whether the document exceeded safe limits */
  exceedsLimit: boolean;
  /** Content type detected */
  contentType: 'markdown' | 'latex' | 'plain';
}

const DEFAULT_CONFIG: ChunkerConfig = {
  chunkSize: 8191,
  chunkOverlap: 400,
  safeTokenLimit: 200000,
  headersToSplit: [
    { level: '#', name: 'Header 1' },
    { level: '##', name: 'Header 2' },
    { level: '###', name: 'Header 3' },
  ],
};

/**
 * MarkdownChunker - Header-aware document chunking service
 *
 * Implements best practices from sensei-server:
 * - Header-aware splitting preserving document structure
 * - Token counting before chunking
 * - Table detection and special handling
 * - Page number tracking
 * - Metadata preservation through chunks
 */
export class MarkdownChunker {
  private config: ChunkerConfig;
  private currentPage: number = 1;

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Estimate token count for a string using a simple heuristic
   * Approximates GPT tokenization: ~4 characters per token on average
   */
  estimateTokenCount(text: string): number {
    if (!text) return 0;
    // More accurate estimation: count words and punctuation
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const punctuation = (text.match(/[.,!?;:'"()\[\]{}]/g) || []).length;
    // Average: 1 word ≈ 1.3 tokens, punctuation ≈ 1 token each
    return Math.ceil(words.length * 1.3 + punctuation * 0.5);
  }

  /**
   * Detect content type from document string
   */
  detectContentType(document: string): 'markdown' | 'latex' | 'plain' {
    if (document.includes('\\begin{') || document.includes('\\end{') || /\$[^$]+\$/.test(document)) {
      return 'latex';
    }
    if (document.includes('# ') || document.includes('## ') || document.includes('- ') || document.includes('* ')) {
      return 'markdown';
    }
    return 'plain';
  }

  /**
   * Check if a line is a page break marker
   */
  isPageBreak(line: string): boolean {
    return line.trim().startsWith('<!-- PageBreak');
  }

  /**
   * Parse page number from a page break comment
   */
  parsePageNumber(line: string): number {
    const match = line.match(/<!-- PageBreak.*?(\d+)/);
    return match ? parseInt(match[1], 10) : this.currentPage;
  }

  /**
   * Detect if content contains a markdown table
   */
  containsTable(content: string): boolean {
    const lines = content.split('\n');
    let hasHeaderRow = false;
    let hasSeparatorRow = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (!hasHeaderRow) {
          hasHeaderRow = true;
        } else if (/^\|[\s:-]+\|/.test(trimmed)) {
          hasSeparatorRow = true;
          break;
        }
      }
    }

    return hasHeaderRow && hasSeparatorRow;
  }

  /**
   * Extract headers from markdown content
   */
  extractHeaders(content: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      for (const { level, name } of this.config.headersToSplit) {
        const regex = new RegExp(`^${level.replace(/[#]/g, '\\#')}\\s+(.+)$`);
        const match = trimmed.match(regex);
        if (match && !trimmed.startsWith(level + '#')) {
          headers[name] = match[1].trim();
        }
      }
    }

    return headers;
  }

  /**
   * Normalize heading levels based on numbering (e.g., 1.2.3 becomes H3)
   */
  normalizeHeadings(markdown: string): string {
    const lines = markdown.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\s*(#+)\s+(\d+(?:\.\d+)*)\s+(.*)$/);
      if (match) {
        const number = match[2];
        const depth = number.split('.').length;
        const level = Math.min(depth + 1, 6);
        result.push('#'.repeat(level) + ' ' + number + ' ' + match[3]);
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
   * Clean unwanted headings between page breaks
   */
  cleanUnwantedHeadings(text: string): string {
    const lines = text.split('\n');
    const cleanedLines: string[] = [];
    let state = 0; // 0: normal, 1: after PageBreak
    let collection: string[] = [];

    for (const line of lines) {
      const stripped = line.trim();

      if (state === 0) {
        if (stripped === '<!-- PageBreak -->') {
          state = 1;
          collection = [stripped];
        } else {
          cleanedLines.push(line);
        }
      } else if (state === 1) {
        if (stripped.startsWith('<!-- PageHeader=')) {
          for (const collected of collection) {
            if (!collected.trim().startsWith('#')) {
              cleanedLines.push(collected);
            } else {
              cleanedLines.push(collected.replace(/^#+\s*/, ''));
            }
          }
          cleanedLines.push(line);
          state = 0;
        } else if (stripped === '<!-- PageBreak -->') {
          cleanedLines.push(...collection);
          cleanedLines.push(line);
          collection = [];
        } else {
          collection.push(line);
        }
      }
    }

    if (state === 1) {
      cleanedLines.push(...collection);
    }

    return cleanedLines.join('\n');
  }

  /**
   * Update current page number based on content
   */
  updateCurrentPage(content: string, stopOnFirstPageBreak: boolean = false): void {
    for (const line of content.split('\n')) {
      if (this.isPageBreak(line)) {
        this.currentPage = this.parsePageNumber(line) + 1;
        if (stopOnFirstPageBreak) {
          break;
        }
      }
    }
  }

  /**
   * Split text using header-aware markdown splitting
   */
  async splitByHeaders(content: string): Promise<Array<{ content: string; metadata: Record<string, string> }>> {
    const result: Array<{ content: string; metadata: Record<string, string> }> = [];
    const sections: Array<{ content: string; headers: Record<string, string> }> = [];

    // Parse markdown and extract sections with their headers
    const lines = content.split('\n');
    let currentSection = '';
    const currentHeaders: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      let isHeader = false;

      for (const { level, name } of this.config.headersToSplit) {
        const pattern = new RegExp(`^${level.replace(/[#]/g, '\\#')}(?!#)\\s+(.+)$`);
        const match = trimmed.match(pattern);
        if (match) {
          // Save previous section if it has content
          if (currentSection.trim()) {
            sections.push({
              content: currentSection.trim(),
              headers: { ...currentHeaders },
            });
          }

          // Update headers (reset lower levels)
          currentHeaders[name] = match[1].trim();
          const levelIndex = this.config.headersToSplit.findIndex((h) => h.name === name);
          for (let i = levelIndex + 1; i < this.config.headersToSplit.length; i++) {
            delete currentHeaders[this.config.headersToSplit[i].name];
          }

          currentSection = line + '\n';
          isHeader = true;
          break;
        }
      }

      if (!isHeader) {
        currentSection += line + '\n';
      }
    }

    // Don't forget the last section
    if (currentSection.trim()) {
      sections.push({
        content: currentSection.trim(),
        headers: { ...currentHeaders },
      });
    }

    for (const section of sections) {
      result.push({
        content: section.content,
        metadata: section.headers,
      });
    }

    return result;
  }

  /**
   * Split content that exceeds chunk size using token-based splitting
   */
  async splitLargeContent(content: string): Promise<string[]> {
    const splitter = new TokenTextSplitter({
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
    });

    return splitter.splitText(content);
  }

  /**
   * Main chunking method - processes document into chunks with metadata
   */
  async chunkDocument(document: string, fileName?: string): Promise<ChunkingResult> {
    this.currentPage = 1;

    const contentType = this.detectContentType(document);
    const totalTokens = this.estimateTokenCount(document);
    const exceedsLimit = totalTokens > this.config.safeTokenLimit;

    if (exceedsLimit) {
      return {
        chunks: [],
        totalTokens,
        exceedsLimit: true,
        contentType,
      };
    }

    const chunks: DocumentChunk[] = [];
    let orderCounter = 0;

    // Preprocess markdown
    let processedContent = document;
    if (contentType === 'markdown') {
      processedContent = this.cleanUnwantedHeadings(document);
      processedContent = this.normalizeHeadings(processedContent);
    }

    // Split by headers for markdown content
    if (contentType === 'markdown') {
      const sections = await this.splitByHeaders(processedContent);

      for (const section of sections) {
        const sectionTokens = this.estimateTokenCount(section.content);

        if (sectionTokens <= this.config.chunkSize) {
          const isTable = this.containsTable(section.content);
          this.updateCurrentPage(section.content);

          chunks.push({
            content: section.content,
            embeddingContent: section.content,
            metadata: {
              headers: section.metadata,
              page: this.currentPage,
              orderInDocument: ++orderCounter,
              isTable,
              fileName,
            },
          });
        } else {
          // Split large sections
          const subChunks = await this.splitLargeContent(section.content);

          for (const subChunk of subChunks) {
            const isTable = this.containsTable(subChunk);
            this.updateCurrentPage(subChunk);

            chunks.push({
              content: subChunk,
              embeddingContent: subChunk,
              metadata: {
                headers: section.metadata,
                page: this.currentPage,
                orderInDocument: ++orderCounter,
                isTable,
                fileName,
              },
            });
          }
        }
      }
    } else {
      // For non-markdown, use appropriate splitter
      const splitter =
        contentType === 'latex'
          ? new LatexTextSplitter({
              chunkSize: this.config.chunkSize,
              chunkOverlap: this.config.chunkOverlap,
            })
          : new RecursiveCharacterTextSplitter({
              chunkSize: this.config.chunkSize,
              chunkOverlap: this.config.chunkOverlap,
            });

      const textChunks = await splitter.splitText(processedContent);

      for (const chunk of textChunks) {
        chunks.push({
          content: chunk,
          embeddingContent: chunk,
          metadata: {
            headers: {},
            page: 1,
            orderInDocument: ++orderCounter,
            isTable: false,
            fileName,
          },
        });
      }
    }

    // Filter out empty chunks
    const filteredChunks = chunks.filter((c) => c.content.trim().length > 0);

    return {
      chunks: filteredChunks,
      totalTokens,
      exceedsLimit: false,
      contentType,
    };
  }

  /**
   * Simple chunking - backwards compatible with original function
   */
  async chunkDocumentSimple(document: string): Promise<string[]> {
    const result = await this.chunkDocument(document);
    return result.chunks.map((c) => c.content);
  }
}

// Default chunker instance
const defaultChunker = new MarkdownChunker();

/**
 * Legacy function for backwards compatibility
 */
export async function chunkDocumentWithOverlap(document: string): Promise<string[]> {
  return defaultChunker.chunkDocumentSimple(document);
}

/**
 * Enhanced chunking with metadata (new API)
 */
export async function chunkDocumentWithMetadata(
  document: string,
  fileName?: string,
  config?: Partial<ChunkerConfig>,
): Promise<ChunkingResult> {
  const chunker = config ? new MarkdownChunker(config) : defaultChunker;
  return chunker.chunkDocument(document, fileName);
}
