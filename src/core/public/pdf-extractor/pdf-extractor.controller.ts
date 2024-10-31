import { Controller, HttpStatus, Logger, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { ApiTags, ApiConsumes } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

import AppConfig, { CONFIG_APP } from '../../../config/app';
import { PdfExtractorService } from './pdf-extractor.service';

@Controller('pdf-extractor')
@ApiTags('pdf-extractor')
export class PdfExtractorController {
  private readonly logger = new Logger(PdfExtractorController.name);
  private appConfig: ConfigType<typeof AppConfig>;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly pdfExtractorService: PdfExtractorService,
  ) {
    this.appConfig = configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);
  }

  @Post('')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async create(@UploadedFile() file: Express.Multer.File, @Res() res: Response) {
    try {
      if (!file) {
        throw new Error('File not provided');
      }

      // Pass the file to the service for extraction
      const data = await this.pdfExtractorService.extract(file);
      return res.status(HttpStatus.OK).json(data);
    } catch (err) {
      this.logger.error(`Extraction failed with error ${err}`);
      if (err.name === 'RestError') {
        return res.status(HttpStatus.BAD_REQUEST).json({
          code: 400,
          message: err.details.error.innererror.message,
        });
      }

      return res.status(HttpStatus.BAD_REQUEST).json(
        err?.response?.data || {
          code: 400,
          message: 'Bad request!',
        },
      );
    }
  }
}
