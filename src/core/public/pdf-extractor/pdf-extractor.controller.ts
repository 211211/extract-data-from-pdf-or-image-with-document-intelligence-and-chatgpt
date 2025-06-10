import { BadRequestException, Controller, Logger, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import AppConfig, { CONFIG_APP } from '../../../config/app';
import { PdfExtractorService } from './pdf-extractor.service';
import { ApiTags, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('pdf-extractor')
@ApiTags('pdf-extractor')
export class PdfExtractorController {
  private readonly logger = new Logger(PdfExtractorController.name);
  private appConfig: ConfigType<typeof AppConfig>;

  constructor(
    private readonly configService: ConfigService,
    private readonly pdfExtractorService: PdfExtractorService,
  ) {
    this.appConfig = configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);
  }

  @Post('extract')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Extract content from a PDF or image (default: tables mode)' })
  @ApiResponse({ status: 200, description: 'Successfully extracted and processed content' })
  @ApiResponse({ status: 400, description: 'Bad request or file not provided' })
  async extract(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File not provided');
    }

    try {
      this.logger.log(`Processing file upload: ${file.originalname}`);
      const data = await this.pdfExtractorService.extract(file);
      const jsonData = this.parseResponseData(data);
      this.logger.log(`Successfully processed file: ${file.originalname}`);
      return jsonData;
    } catch (error) {
      this.logger.error(
        `Extraction failed for ${file.originalname}`,
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException(error.response?.data || error.message || 'Failed to process the file');
    }
  }

  @Post('extract-text')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Extract plain text (OCR) from a PDF or image' })
  @ApiResponse({ status: 200, description: 'Successfully extracted text content' })
  @ApiResponse({ status: 400, description: 'Bad request or file not provided' })
  async extractText(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File not provided');
    }

    try {
      this.logger.log(`Processing text extraction for: ${file.originalname}`);
      const data = await this.pdfExtractorService.extractText(file);
      const jsonData = this.parseResponseData(data);
      this.logger.log(`Successfully extracted text from: ${file.originalname}`);
      return jsonData;
    } catch (error) {
      this.logger.error(
        `Text extraction failed for ${file.originalname}`,
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException(error.response?.data || error.message || 'Failed to process the file');
    }
  }

  @Post('extract-tables')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Extract tables and layout from a PDF or image' })
  @ApiResponse({ status: 200, description: 'Successfully extracted tables and layout' })
  @ApiResponse({ status: 400, description: 'Bad request or file not provided' })
  async extractTables(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File not provided');
    }

    try {
      this.logger.log(`Processing table extraction for: ${file.originalname}`);
      const data = await this.pdfExtractorService.extractTables(file);
      const jsonData = this.parseResponseData(data);
      this.logger.log(`Successfully extracted tables from: ${file.originalname}`);
      return jsonData;
    } catch (error) {
      this.logger.error(
        `Table extraction failed for ${file.originalname}`,
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException(error.response?.data || error.message || 'Failed to process the file');
    }
  }

  /**
   * Helper method to parse response data into JSON if it's a string.
   * @param data The raw response data from the service.
   * @returns Parsed JSON data or the original data if already an object.
   */
  private parseResponseData(data: string | any): any {
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (parseError) {
      this.logger.warn(
        'Response data is not valid JSON, returning as-is',
        parseError instanceof Error ? parseError.message : String(parseError),
      );
      return data; // Return as-is if JSON parsing fails
    }
  }
}
