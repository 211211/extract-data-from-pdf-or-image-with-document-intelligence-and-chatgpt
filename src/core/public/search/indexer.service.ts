import * as fs from 'fs';
import * as path from 'path';

import { Injectable, Logger } from '@nestjs/common';

import { AzureCogDocumentIndex } from '../pdf-extractor/services/azure-cog-vector-store';
import { PdfExtractorService } from '../pdf-extractor/pdf-extractor.service';
import { SearchService } from './search.service';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  constructor(private readonly pdfExtractor: PdfExtractorService, private readonly searchService: SearchService) {}

  /**
   * Read all PDF files in a folder, extract their content, and index them.
   * @param folderPath local filesystem path containing PDF files
   * @param user identifier for the user
   * @param chatThreadId identifier for the chat thread
   * @returns array of indexed documents
   */
  async indexFolder(folderPath: string, user: string, chatThreadId: string): Promise<AzureCogDocumentIndex[]> {
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.pdf'));
    const docs: AzureCogDocumentIndex[] = [];
    for (const fileName of files) {
      const fullPath = path.join(folderPath, fileName);
      this.logger.log(`Processing ${fullPath}`);
      const buffer = fs.readFileSync(fullPath);
      const raw = await this.pdfExtractor.extract(buffer as any);
      const pageContent = typeof raw === 'string' ? raw : JSON.stringify(raw);
      docs.push({ id: fileName, pageContent, user, chatThreadId, metadata: fileName });
    }
    await this.searchService.index(docs);
    return docs;
  }
}
