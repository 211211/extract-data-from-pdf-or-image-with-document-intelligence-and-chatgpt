import { BadRequestException, Controller, Logger, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import AppConfig, { CONFIG_APP } from '../../../config/app';
import { PdfExtractorService } from './pdf-extractor.service';
import { ApiTags, ApiConsumes } from '@nestjs/swagger';

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

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async create(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File not provided');
    }

    try {
      const data = await this.pdfExtractorService.extract(file);
      const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
      return jsonData;
    } catch (error) {
      this.logger.error('Extraction failed', error);
      throw new BadRequestException(error.response?.data || 'Bad request!');
    }
  }
}
