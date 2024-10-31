import { Controller, HttpStatus, Logger, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { Response } from 'express';
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
  async create(@UploadedFile() file: Express.Multer.File, @Res() res: Response) {
    try {
      if (!file) {
        throw new Error('File not provided');
      }

      const data = await this.pdfExtractorService.extract(file);
      return res.status(HttpStatus.OK).json(data);
    } catch (error) {
      this.logger.error('Extraction failed', error);

      return res.status(HttpStatus.BAD_REQUEST).json(
        error.response?.data || {
          code: 400,
          message: 'Bad request!',
        },
      );
    }
  }
}
