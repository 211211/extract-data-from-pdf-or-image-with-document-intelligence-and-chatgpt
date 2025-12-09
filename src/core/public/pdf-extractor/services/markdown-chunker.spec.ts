import {
  MarkdownChunker,
  chunkDocumentWithOverlap,
  chunkDocumentWithMetadata,
  ChunkerConfig,
  DocumentChunk,
} from './markdown-chunker';

describe('MarkdownChunker', () => {
  let chunker: MarkdownChunker;

  beforeEach(() => {
    chunker = new MarkdownChunker();
  });

  // -------------------------------------------------------------------------
  // Token Estimation
  // -------------------------------------------------------------------------

  describe('estimateTokenCount', () => {
    it('should return 0 for empty string', () => {
      expect(chunker.estimateTokenCount('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(chunker.estimateTokenCount(null as any)).toBe(0);
      expect(chunker.estimateTokenCount(undefined as any)).toBe(0);
    });

    it('should estimate tokens for simple text', () => {
      const text = 'Hello world';
      const tokens = chunker.estimateTokenCount(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should account for punctuation', () => {
      const withPunctuation = 'Hello, world! How are you?';
      const withoutPunctuation = 'Hello world How are you';
      const tokensWithPunctuation = chunker.estimateTokenCount(withPunctuation);
      const tokensWithoutPunctuation = chunker.estimateTokenCount(withoutPunctuation);
      expect(tokensWithPunctuation).toBeGreaterThan(tokensWithoutPunctuation);
    });

    it('should handle long text', () => {
      const longText = 'word '.repeat(1000);
      const tokens = chunker.estimateTokenCount(longText);
      expect(tokens).toBeGreaterThan(1000);
    });
  });

  // -------------------------------------------------------------------------
  // Content Type Detection
  // -------------------------------------------------------------------------

  describe('detectContentType', () => {
    it('should detect markdown content', () => {
      expect(chunker.detectContentType('# Heading\nSome text')).toBe('markdown');
      expect(chunker.detectContentType('## Subheading')).toBe('markdown');
      expect(chunker.detectContentType('- List item')).toBe('markdown');
      expect(chunker.detectContentType('* Another list item')).toBe('markdown');
    });

    it('should detect latex content', () => {
      expect(chunker.detectContentType('\\begin{document}')).toBe('latex');
      expect(chunker.detectContentType('\\end{document}')).toBe('latex');
      expect(chunker.detectContentType('$E = mc^2$')).toBe('latex');
    });

    it('should detect plain content', () => {
      expect(chunker.detectContentType('Just plain text')).toBe('plain');
      expect(chunker.detectContentType('No special formatting here')).toBe('plain');
    });
  });

  // -------------------------------------------------------------------------
  // Page Break Detection
  // -------------------------------------------------------------------------

  describe('isPageBreak', () => {
    it('should detect page break comments', () => {
      expect(chunker.isPageBreak('<!-- PageBreak -->')).toBe(true);
      expect(chunker.isPageBreak('<!-- PageBreak 5 -->')).toBe(true);
      expect(chunker.isPageBreak('  <!-- PageBreak -->  ')).toBe(true);
    });

    it('should not detect non-page-break content', () => {
      expect(chunker.isPageBreak('# Heading')).toBe(false);
      expect(chunker.isPageBreak('<!-- Comment -->')).toBe(false);
      expect(chunker.isPageBreak('Regular text')).toBe(false);
    });
  });

  describe('parsePageNumber', () => {
    it('should parse page number from comment', () => {
      expect(chunker.parsePageNumber('<!-- PageBreak 5 -->')).toBe(5);
      expect(chunker.parsePageNumber('<!-- PageBreak 10 -->')).toBe(10);
      expect(chunker.parsePageNumber('<!-- PageBreak page=3 -->')).toBe(3);
    });

    it('should return current page if no number found', () => {
      expect(chunker.parsePageNumber('<!-- PageBreak -->')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Table Detection
  // -------------------------------------------------------------------------

  describe('containsTable', () => {
    it('should detect markdown tables', () => {
      const tableContent = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`;
      expect(chunker.containsTable(tableContent)).toBe(true);
    });

    it('should not detect non-table content', () => {
      expect(chunker.containsTable('Just regular text')).toBe(false);
      expect(chunker.containsTable('# Heading\nParagraph')).toBe(false);
    });

    it('should handle tables with alignment', () => {
      const alignedTable = `
| Left | Center | Right |
|:-----|:------:|------:|
| L    | C      | R     |
`;
      expect(chunker.containsTable(alignedTable)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Header Extraction
  // -------------------------------------------------------------------------

  describe('extractHeaders', () => {
    it('should extract headers from markdown', () => {
      const content = `
# Main Title
Some content

## Section 1
Content

### Subsection 1.1
More content
`;
      const headers = chunker.extractHeaders(content);
      expect(headers['Header 1']).toBe('Main Title');
      expect(headers['Header 2']).toBe('Section 1');
      expect(headers['Header 3']).toBe('Subsection 1.1');
    });

    it('should handle missing headers', () => {
      const content = 'Just plain text without headers';
      const headers = chunker.extractHeaders(content);
      expect(Object.keys(headers).length).toBe(0);
    });

    it('should not confuse code comments with headers', () => {
      const content = '#### Not H4 because too deep by default';
      const headers = chunker.extractHeaders(content);
      expect(headers['Header 4']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Heading Normalization
  // -------------------------------------------------------------------------

  describe('normalizeHeadings', () => {
    it('should normalize numbered headings', () => {
      const input = '# 1.2.3 Some Title';
      const normalized = chunker.normalizeHeadings(input);
      expect(normalized).toBe('#### 1.2.3 Some Title');
    });

    it('should handle single level numbers', () => {
      const input = '# 1 Introduction';
      const normalized = chunker.normalizeHeadings(input);
      expect(normalized).toBe('## 1 Introduction');
    });

    it('should not modify non-numbered headings', () => {
      const input = '# Regular Heading';
      const normalized = chunker.normalizeHeadings(input);
      expect(normalized).toBe('# Regular Heading');
    });

    it('should preserve non-heading lines', () => {
      const input = 'Regular paragraph text';
      const normalized = chunker.normalizeHeadings(input);
      expect(normalized).toBe('Regular paragraph text');
    });
  });

  // -------------------------------------------------------------------------
  // Clean Unwanted Headings
  // -------------------------------------------------------------------------

  describe('cleanUnwantedHeadings', () => {
    it('should clean headings between page break and page header', () => {
      const input = `Some content
<!-- PageBreak -->
# Unwanted Heading
<!-- PageHeader="Page 2" -->
Real content`;

      const cleaned = chunker.cleanUnwantedHeadings(input);
      expect(cleaned).not.toContain('# Unwanted');
      expect(cleaned).toContain('Unwanted Heading');
    });

    it('should preserve content between two page breaks', () => {
      const input = `<!-- PageBreak -->
# Heading
<!-- PageBreak -->`;

      const cleaned = chunker.cleanUnwantedHeadings(input);
      expect(cleaned).toContain('# Heading');
    });
  });

  // -------------------------------------------------------------------------
  // Split By Headers
  // -------------------------------------------------------------------------

  describe('splitByHeaders', () => {
    it('should split content by headers', async () => {
      const content = `
# Section 1
Content of section 1

## Subsection 1.1
Content of subsection 1.1

# Section 2
Content of section 2
`;

      const sections = await chunker.splitByHeaders(content);

      expect(sections.length).toBeGreaterThan(0);
      expect(sections.some((s) => s.metadata['Header 1'] === 'Section 1')).toBe(true);
      expect(sections.some((s) => s.metadata['Header 1'] === 'Section 2')).toBe(true);
    });

    it('should preserve header hierarchy', async () => {
      const content = `
# Main
## Sub
Content
`;

      const sections = await chunker.splitByHeaders(content);

      // The last section should have both headers
      const lastSection = sections[sections.length - 1];
      expect(lastSection.metadata['Header 1']).toBe('Main');
      expect(lastSection.metadata['Header 2']).toBe('Sub');
    });

    it('should handle content without headers', async () => {
      const content = 'Just plain text without any headers';
      const sections = await chunker.splitByHeaders(content);

      expect(sections.length).toBe(1);
      expect(sections[0].content).toContain('Just plain text');
    });
  });

  // -------------------------------------------------------------------------
  // Main Chunking Method
  // -------------------------------------------------------------------------

  describe('chunkDocument', () => {
    it('should chunk markdown document', async () => {
      const document = `
# Introduction
This is the introduction section.

## Background
Background information here.

# Methods
This section describes the methods used.
`;

      const result = await chunker.chunkDocument(document);

      expect(result.contentType).toBe('markdown');
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.exceedsLimit).toBe(false);
    });

    it('should preserve metadata through chunks', async () => {
      const document = `
# Main Section
Content of main section

## Subsection
Content of subsection
`;

      const result = await chunker.chunkDocument(document, 'test.md');

      for (const chunk of result.chunks) {
        expect(chunk.metadata.fileName).toBe('test.md');
        expect(chunk.metadata.orderInDocument).toBeGreaterThan(0);
        expect(typeof chunk.metadata.isTable).toBe('boolean');
      }
    });

    it('should detect tables in chunks', async () => {
      const document = `
# Table Section

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`;

      const result = await chunker.chunkDocument(document);

      const tableChunk = result.chunks.find((c) => c.metadata.isTable);
      expect(tableChunk).toBeDefined();
    });

    it('should return empty chunks for documents exceeding safe limit', async () => {
      const smallChunker = new MarkdownChunker({ safeTokenLimit: 10 });
      const document = 'This document definitely exceeds the tiny token limit we set';

      const result = await smallChunker.chunkDocument(document);

      expect(result.exceedsLimit).toBe(true);
      expect(result.chunks.length).toBe(0);
    });

    it('should handle plain text documents', async () => {
      const document = 'Plain text without any markdown formatting. Just regular content.';

      const result = await chunker.chunkDocument(document);

      expect(result.contentType).toBe('plain');
      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should handle latex documents', async () => {
      const document = `
\\begin{document}
Some latex content $E = mc^2$
\\end{document}
`;

      const result = await chunker.chunkDocument(document);

      expect(result.contentType).toBe('latex');
      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should filter out empty chunks', async () => {
      const document = `
# Section 1
Content

# Section 2


# Section 3
More content
`;

      const result = await chunker.chunkDocument(document);

      const emptyChunks = result.chunks.filter((c) => c.content.trim().length === 0);
      expect(emptyChunks.length).toBe(0);
    });

    it('should maintain order across chunks', async () => {
      const document = `
# First
First content

# Second
Second content

# Third
Third content
`;

      const result = await chunker.chunkDocument(document);

      const orders = result.chunks.map((c) => c.metadata.orderInDocument);
      const sortedOrders = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sortedOrders);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration Options
  // -------------------------------------------------------------------------

  describe('custom configuration', () => {
    it('should respect custom chunk size', async () => {
      const smallChunker = new MarkdownChunker({ chunkSize: 50, chunkOverlap: 10 });
      const document = 'word '.repeat(100);

      const result = await smallChunker.chunkDocument(document);

      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it('should use custom headers to split', async () => {
      const customChunker = new MarkdownChunker({
        headersToSplit: [{ level: '####', name: 'Header 4' }],
      });

      const document = `
#### Custom Header
Content
`;

      const result = await customChunker.chunkDocument(document);

      expect(result.chunks.some((c) => c.metadata.headers['Header 4'] === 'Custom Header')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Backward Compatibility
  // -------------------------------------------------------------------------

  describe('chunkDocumentSimple', () => {
    it('should return simple string array', async () => {
      const document = '# Heading\nContent';

      const chunks = await chunker.chunkDocumentSimple(document);

      expect(Array.isArray(chunks)).toBe(true);
      expect(typeof chunks[0]).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // Legacy API
  // -------------------------------------------------------------------------

  describe('chunkDocumentWithOverlap (legacy)', () => {
    it('should work as drop-in replacement', async () => {
      const document = '# Heading\nThis is some content.';

      const chunks = await chunkDocumentWithOverlap(document);

      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Enhanced API
  // -------------------------------------------------------------------------

  describe('chunkDocumentWithMetadata', () => {
    it('should return full chunking result', async () => {
      const document = '# Heading\nContent here.';

      const result = await chunkDocumentWithMetadata(document, 'test.md');

      expect(result.chunks).toBeDefined();
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.contentType).toBeDefined();
      expect(result.chunks[0].metadata.fileName).toBe('test.md');
    });

    it('should accept custom configuration', async () => {
      const document = 'Content';
      const config: Partial<ChunkerConfig> = { chunkSize: 500, chunkOverlap: 50 };

      const result = await chunkDocumentWithMetadata(document, undefined, config);

      expect(result).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty document', async () => {
      const result = await chunker.chunkDocument('');

      expect(result.chunks.length).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it('should handle document with only whitespace', async () => {
      const result = await chunker.chunkDocument('   \n\n   \t   ');

      expect(result.chunks.length).toBe(0);
    });

    it('should handle document with special characters', async () => {
      const document = '# Title with émojis 🚀 and spëcial çharacters';

      const result = await chunker.chunkDocument(document);

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.chunks[0].content).toContain('🚀');
    });

    it('should handle very long headers', async () => {
      const longHeader = '# ' + 'A'.repeat(1000);
      const document = longHeader + '\nContent';

      const result = await chunker.chunkDocument(document);

      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should handle deeply nested headers', async () => {
      const document = `
# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6
Content
`;

      const result = await chunker.chunkDocument(document);

      expect(result.chunks.length).toBeGreaterThan(0);
    });
  });
});
