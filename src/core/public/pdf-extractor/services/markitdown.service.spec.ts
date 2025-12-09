import { MarkItDownService } from './markitdown.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MarkItDownService', () => {
  let service: MarkItDownService;

  beforeEach(() => {
    service = new MarkItDownService();
  });

  // -------------------------------------------------------------------------
  // Service Initialization
  // -------------------------------------------------------------------------

  describe('initialization', () => {
    it('should create service instance', () => {
      expect(service).toBeDefined();
    });

    it('should have checkAvailability method', () => {
      expect(typeof service.checkAvailability).toBe('function');
    });

    it('should have isServiceAvailable method', () => {
      expect(typeof service.isServiceAvailable).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Supported Extensions
  // -------------------------------------------------------------------------

  describe('getSupportedExtensions', () => {
    it('should return an array of supported extensions', () => {
      const extensions = service.getSupportedExtensions();

      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
    });

    it('should include PDF format', () => {
      const extensions = service.getSupportedExtensions();
      expect(extensions).toContain('.pdf');
    });

    it('should include Microsoft Office formats', () => {
      const extensions = service.getSupportedExtensions();

      expect(extensions).toContain('.docx');
      expect(extensions).toContain('.xlsx');
      expect(extensions).toContain('.pptx');
    });

    it('should include image formats', () => {
      const extensions = service.getSupportedExtensions();

      expect(extensions).toContain('.jpg');
      expect(extensions).toContain('.jpeg');
      expect(extensions).toContain('.png');
    });

    it('should include text/web formats', () => {
      const extensions = service.getSupportedExtensions();

      expect(extensions).toContain('.html');
      expect(extensions).toContain('.txt');
      expect(extensions).toContain('.csv');
    });
  });

  // -------------------------------------------------------------------------
  // Extension Support Check
  // -------------------------------------------------------------------------

  describe('isExtensionSupported', () => {
    it('should return true for supported extensions', () => {
      expect(service.isExtensionSupported('.pdf')).toBe(true);
      expect(service.isExtensionSupported('.docx')).toBe(true);
      expect(service.isExtensionSupported('.xlsx')).toBe(true);
    });

    it('should handle extensions without leading dot', () => {
      expect(service.isExtensionSupported('pdf')).toBe(true);
      expect(service.isExtensionSupported('docx')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(service.isExtensionSupported('.PDF')).toBe(true);
      expect(service.isExtensionSupported('.DOCX')).toBe(true);
      expect(service.isExtensionSupported('PDF')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(service.isExtensionSupported('.xyz')).toBe(false);
      expect(service.isExtensionSupported('.unknown')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Convert File (Unit Tests - No actual conversion)
  // -------------------------------------------------------------------------

  describe('convertFile', () => {
    it('should return error for non-existent file when service unavailable', async () => {
      // Service is not initialized, so isAvailable is false
      const result = await service.convertFile('/non/existent/file.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.markdown).toBeNull();
    });

    it('should return MarkItDownResult structure', async () => {
      const result = await service.convertFile('/any/path.pdf');

      // Check structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('markdown');
    });
  });

  // -------------------------------------------------------------------------
  // Convert Buffer (Unit Tests)
  // -------------------------------------------------------------------------

  describe('convertBuffer', () => {
    it('should handle buffer conversion request', async () => {
      const buffer = Buffer.from('test content');
      const result = await service.convertBuffer(buffer, '.txt');

      // Should return result structure (will fail without markitdown installed)
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('markdown');
    });

    it('should normalize file extension with dot', async () => {
      const buffer = Buffer.from('test');

      // Both should work the same
      const result1 = await service.convertBuffer(buffer, '.txt');
      const result2 = await service.convertBuffer(buffer, 'txt');

      expect(result1.fileExtension).toBe('.txt');
      expect(result2.fileExtension).toBe('.txt');
    });
  });

  // -------------------------------------------------------------------------
  // Convert Multer File (Unit Tests)
  // -------------------------------------------------------------------------

  describe('convertMulterFile', () => {
    it('should handle multer file object', async () => {
      const multerFile = {
        buffer: Buffer.from('test content'),
        originalname: 'document.txt',
        mimetype: 'text/plain',
      };

      const result = await service.convertMulterFile(multerFile);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('fileName');
      expect(result.fileName).toBe('document.txt');
    });

    it('should extract extension from original filename', async () => {
      const multerFile = {
        buffer: Buffer.from('test'),
        originalname: 'report.pdf',
        mimetype: 'application/pdf',
      };

      const result = await service.convertMulterFile(multerFile);

      expect(result.fileName).toBe('report.pdf');
    });
  });

  // -------------------------------------------------------------------------
  // Service Availability
  // -------------------------------------------------------------------------

  describe('service availability', () => {
    it('should initially report unavailable before initialization', () => {
      const newService = new MarkItDownService();
      // Before onModuleInit, service should be unavailable
      expect(newService.isServiceAvailable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Integration Tests (only run if markitdown is installed)
  // -------------------------------------------------------------------------

  describe('integration tests', () => {
    let integrationService: MarkItDownService;
    let isMarkItDownAvailable: boolean;

    beforeAll(async () => {
      integrationService = new MarkItDownService();
      isMarkItDownAvailable = await integrationService.checkAvailability();
    });

    it('should check availability', () => {
      // This test always passes - it just logs whether markitdown is available
      if (isMarkItDownAvailable) {
        console.log('MarkItDown is available - integration tests will run');
      } else {
        console.log('MarkItDown not installed - skipping integration tests');
      }
      expect(typeof isMarkItDownAvailable).toBe('boolean');
    });

    it('should convert plain text file if available', async () => {
      if (!isMarkItDownAvailable) {
        console.log('Skipping: MarkItDown not available');
        return;
      }

      // Create a temporary text file
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `test_${Date.now()}.txt`);
      const testContent = '# Test Heading\n\nThis is a test paragraph.';

      try {
        fs.writeFileSync(tempFile, testContent);

        const result = await integrationService.convertFile(tempFile);

        expect(result.success).toBe(true);
        expect(result.markdown).toBeDefined();
        expect(result.markdown).toContain('Test');
      } finally {
        // Cleanup
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    });

    it('should convert buffer if available', async () => {
      if (!isMarkItDownAvailable) {
        console.log('Skipping: MarkItDown not available');
        return;
      }

      const content = '# Hello World\n\nThis is markdown content.';
      const buffer = Buffer.from(content);

      const result = await integrationService.convertBuffer(buffer, '.txt');

      expect(result.success).toBe(true);
      expect(result.markdown).toContain('Hello');
    });

    it('should handle HTML content if available', async () => {
      if (!isMarkItDownAvailable) {
        console.log('Skipping: MarkItDown not available');
        return;
      }

      const htmlContent = '<html><body><h1>Title</h1><p>Paragraph</p></body></html>';
      const buffer = Buffer.from(htmlContent);

      const result = await integrationService.convertBuffer(buffer, '.html');

      expect(result.success).toBe(true);
      if (result.markdown) {
        expect(result.markdown.toLowerCase()).toContain('title');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('should handle non-existent file gracefully', async () => {
      const result = await service.convertFile('/path/that/does/not/exist.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).not.toBeNull();
    });

    it('should return proper error structure', async () => {
      const result = await service.convertFile('/invalid/path.pdf');

      expect(result).toMatchObject({
        success: false,
        markdown: null,
      });
      expect(typeof result.error).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // Result Structure
  // -------------------------------------------------------------------------

  describe('result structure', () => {
    it('should always return MarkItDownResult interface', async () => {
      const result = await service.convertFile('/any/file.pdf');

      // Type check - these properties must exist
      expect('success' in result).toBe(true);
      expect('error' in result).toBe(true);
      expect('markdown' in result).toBe(true);

      // Type validation
      expect(typeof result.success).toBe('boolean');
      expect(result.error === null || typeof result.error === 'string').toBe(true);
      expect(result.markdown === null || typeof result.markdown === 'string').toBe(true);
    });
  });
});
