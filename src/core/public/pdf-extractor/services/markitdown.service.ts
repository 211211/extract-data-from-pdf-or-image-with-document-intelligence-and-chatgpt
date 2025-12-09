import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SpawnOptions, spawn } from 'child_process';

/**
 * Result of a MarkItDown conversion
 */
export interface MarkItDownResult {
  /** Whether the conversion was successful */
  success: boolean;
  /** Error message if conversion failed */
  error: string | null;
  /** The converted markdown content */
  markdown: string | null;
  /** Original file path */
  filePath?: string;
  /** Original file name */
  fileName?: string;
  /** File extension */
  fileExtension?: string;
}

/**
 * Options for MarkItDown conversion
 */
export interface MarkItDownOptions {
  /** Python executable path (default: 'python3' or 'python') */
  pythonPath?: string;
  /** Enable MarkItDown plugins */
  enablePlugins?: boolean;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

/**
 * MarkItDownService - Node.js wrapper for Microsoft's official MarkItDown Python library
 *
 * This service provides a bridge between Node.js and the Python MarkItDown library,
 * enabling conversion of various document formats (PDF, Word, Excel, PowerPoint, etc.)
 * to Markdown.
 *
 * @example
 * ```typescript
 * const service = new MarkItDownService();
 *
 * // Convert a file
 * const result = await service.convertFile('/path/to/document.pdf');
 * console.log(result.markdown);
 *
 * // Convert from buffer
 * const buffer = fs.readFileSync('document.docx');
 * const result = await service.convertBuffer(buffer, '.docx');
 * ```
 */
@Injectable()
export class MarkItDownService implements OnModuleInit {
  private readonly logger = new Logger(MarkItDownService.name);
  private readonly scriptPath: string;
  private readonly projectRoot: string;
  private pythonPath: string = 'python3';
  private isAvailable: boolean = false;

  constructor() {
    // Resolve path to the Python script and project root
    this.scriptPath = path.resolve(__dirname, '../../../../../scripts/markitdown_converter.py');
    this.projectRoot = path.resolve(__dirname, '../../../../../');
  }

  /**
   * Initialize the service and check Python/MarkItDown availability
   */
  async onModuleInit(): Promise<void> {
    await this.checkAvailability();
  }

  /**
   * Get the path to the local virtual environment Python
   */
  private getVenvPythonPath(): string | null {
    const venvPaths = [
      path.join(this.projectRoot, '.venv', 'bin', 'python'),
      path.join(this.projectRoot, '.venv', 'Scripts', 'python.exe'), // Windows
      path.join(this.projectRoot, 'venv', 'bin', 'python'),
      path.join(this.projectRoot, 'venv', 'Scripts', 'python.exe'), // Windows
    ];

    for (const venvPath of venvPaths) {
      if (fs.existsSync(venvPath)) {
        return venvPath;
      }
    }

    return null;
  }

  /**
   * Check if MarkItDown is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Build list of Python paths to try
      // Priority: 1. Local venv, 2. System python3, 3. System python
      const pythonPaths: string[] = [];

      // Check for local virtual environment first
      const venvPython = this.getVenvPythonPath();
      if (venvPython) {
        pythonPaths.push(venvPython);
        this.logger.debug(`Found local venv: ${venvPython}`);
      }

      // Add system Python as fallback
      pythonPaths.push('python3', 'python');

      // Try each Python path
      for (const pythonCmd of pythonPaths) {
        try {
          const result = await this.runPythonScript(['--check'], { pythonPath: pythonCmd, timeout: 10000 });
          const parsed = JSON.parse(result);
          if (parsed.installed) {
            this.pythonPath = pythonCmd;
            this.isAvailable = true;
            const isVenv = pythonCmd.includes('.venv') || pythonCmd.includes('venv');
            this.logger.log(`MarkItDown is available (using ${isVenv ? 'local venv' : 'system'}: ${pythonCmd})`);
            return true;
          }
        } catch {
          // Try next python command
        }
      }

      this.isAvailable = false;
      this.logger.warn('MarkItDown is not available. Run: ./scripts/setup-python.sh (or pip install markitdown)');
      return false;
    } catch (error) {
      this.isAvailable = false;
      this.logger.warn(`Failed to check MarkItDown availability: ${error}`);
      return false;
    }
  }

  /**
   * Check if the service is available
   */
  isServiceAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Convert a file to Markdown
   *
   * @param filePath - Path to the file to convert
   * @param options - Conversion options
   * @returns Conversion result with markdown content
   */
  async convertFile(filePath: string, options: MarkItDownOptions = {}): Promise<MarkItDownResult> {
    if (!this.isAvailable) {
      return {
        success: false,
        error: 'MarkItDown is not available. Run: ./scripts/setup-python.sh',
        markdown: null,
        filePath,
      };
    }

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
        markdown: null,
        filePath,
      };
    }

    try {
      const args = [filePath, '--json'];
      if (options.enablePlugins) {
        args.push('--enable-plugins');
      }

      const output = await this.runPythonScript(args, options);
      const result: MarkItDownResult = JSON.parse(output);

      if (result.success) {
        this.logger.debug(`Successfully converted: ${filePath}`);
      } else {
        this.logger.warn(`Conversion failed for ${filePath}: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error converting file ${filePath}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        markdown: null,
        filePath,
      };
    }
  }

  /**
   * Convert a buffer to Markdown
   *
   * @param buffer - File content as Buffer
   * @param fileExtension - File extension (e.g., '.pdf', '.docx')
   * @param options - Conversion options
   * @returns Conversion result with markdown content
   */
  async convertBuffer(
    buffer: Buffer,
    fileExtension: string,
    options: MarkItDownOptions = {},
  ): Promise<MarkItDownResult> {
    // Ensure extension starts with dot
    const ext = fileExtension.startsWith('.') ? fileExtension : `.${fileExtension}`;

    if (!this.isAvailable) {
      return {
        success: false,
        error: 'MarkItDown is not available. Run: ./scripts/setup-python.sh',
        markdown: null,
        fileExtension: ext,
      };
    }

    // Create temporary file
    const tempDir = os.tmpdir();
    const tempFileName = `markitdown_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const tempFilePath = path.join(tempDir, tempFileName);

    try {
      // Write buffer to temp file
      fs.writeFileSync(tempFilePath, buffer);

      // Convert using file method
      const result = await this.convertFile(tempFilePath, options);

      // Update result to reflect it was from buffer
      result.filePath = undefined;
      result.fileExtension = ext;

      return result;
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        this.logger.warn(`Failed to clean up temp file: ${tempFilePath}`);
      }
    }
  }

  /**
   * Convert an Express/Multer file to Markdown
   *
   * @param file - Multer file object
   * @param options - Conversion options
   * @returns Conversion result with markdown content
   */
  async convertMulterFile(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    options: MarkItDownOptions = {},
  ): Promise<MarkItDownResult> {
    const ext = path.extname(file.originalname) || this.mimeToExtension(file.mimetype);

    const result = await this.convertBuffer(file.buffer, ext, options);

    // Enrich result with file info
    result.fileName = file.originalname;

    return result;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return [
      // Documents
      '.pdf',
      '.docx',
      '.doc',
      '.xlsx',
      '.xls',
      '.pptx',
      '.ppt',
      // Images
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.tiff',
      '.tif',
      // Web/Text
      '.html',
      '.htm',
      '.txt',
      '.csv',
      '.xml',
      '.json',
      '.md',
      '.rst',
      // Audio (metadata extraction)
      '.mp3',
      '.wav',
      '.m4a',
    ];
  }

  /**
   * Check if a file extension is supported
   */
  isExtensionSupported(extension: string): boolean {
    const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    return this.getSupportedExtensions().includes(ext);
  }

  /**
   * Run the Python script with arguments
   */
  private runPythonScript(args: string[], options: MarkItDownOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonPath = options.pythonPath || this.pythonPath;
      const timeout = options.timeout || 60000;

      const spawnOptions: SpawnOptions = {
        cwd: path.dirname(this.scriptPath),
        timeout,
      };

      const process = spawn(pythonPath, [this.scriptPath, ...args], spawnOptions);

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Convert MIME type to file extension
   */
  private mimeToExtension(mimetype: string): string {
    const mimeMap: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/vnd.ms-powerpoint': '.ppt',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
      'text/html': '.html',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/xml': '.xml',
      'application/json': '.json',
    };

    return mimeMap[mimetype] || '.bin';
  }
}
