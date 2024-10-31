import AppConfig, { CONFIG_APP } from '../../../config/app';
import { ConfigService, ConfigType } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';

import { HttpService } from '@nestjs/axios';
import { OpenAIInstance } from './openai.service';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';
import { loadFile } from './document-intelligence.service';
import { textPrompt } from './prompt';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);
  private appConfig: ConfigType<typeof AppConfig>;

  constructor(private readonly configService: ConfigService, private readonly httpService: HttpService) {
    this.appConfig = configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);
  }

  async extract(file: PdfExtractorDto['file']) {
    try {
      const documentIntelligenceResponse = await loadFile(file);
      console.log({ documentIntelligenceResponse });
      try {
        // Make the POST request to OpenAI API
        const client = OpenAIInstance();
        const gptResponse = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: textPrompt,
            },
            {
              role: 'user',
              content: JSON.stringify(documentIntelligenceResponse),
            },
          ],
          temperature: 0,
          max_tokens: 4096,
        });

        console.log({ gptResponse: gptResponse.choices[0].message.content });
        // return the content from the API response
        return gptResponse.choices[0].message.content;
      } catch (error) {
        console.error('Error while calling OpenAI API:', error);
        throw error;
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`RestError: ${error.message}`, error.message);
      } else {
        this.logger.error('Failed to extract data from PDF', error);
      }
      throw error;
    }
  }
}
