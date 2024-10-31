import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import AppConfig, { CONFIG_APP } from '../../../config/app';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';
import { textPrompt } from './prompt';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);
  private appConfig: ConfigType<typeof AppConfig>;

  constructor(
    private readonly configService: ConfigService,
    @Inject('OpenAIClient') private readonly openAIClient: any,
    @Inject('DocumentIntelligenceClient') private readonly documentIntelligenceClient: any,
  ) {
    this.appConfig = this.configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);
  }

  async extract(file: PdfExtractorDto['file']) {
    try {
      // Process file using Document Intelligence client directly
      const blob = new Blob([file.buffer], { type: file.mimetype });
      const poller = await this.documentIntelligenceClient.beginAnalyzeDocument(
        'prebuilt-read',
        await blob.arrayBuffer(),
      );
      const documentIntelligenceResponse = await poller.pollUntilDone();

      // Use injected OpenAI client for response generation
      const gptResponse = await this.openAIClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: textPrompt },
          { role: 'user', content: JSON.stringify(documentIntelligenceResponse) },
        ],
        temperature: 0,
        max_tokens: 4096,
      });

      return gptResponse.choices[0].message.content;
    } catch (error) {
      this.logger.error('Failed to extract data from PDF', error instanceof Error ? error.message : error);
      throw error;
    }
  }
}
