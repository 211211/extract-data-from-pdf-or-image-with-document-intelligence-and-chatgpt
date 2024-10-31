import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { DocumentAnalysisClient, AnalyzeResult } from '@azure/ai-form-recognizer';
import OpenAI from 'openai';
import AppConfig, { CONFIG_APP } from '../../../config/app';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';
import { textPrompt } from './prompt';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);
  private appConfig: ConfigType<typeof AppConfig>;

  constructor(
    private readonly configService: ConfigService,
    @Inject('OpenAIClient') private readonly openAIClient: OpenAI,
    @Inject('DocumentIntelligenceClient') private readonly documentIntelligenceClient: DocumentAnalysisClient,
  ) {
    this.appConfig = this.configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);
  }

  async extract(file: PdfExtractorDto['file']): Promise<string> {
    try {
      // Use Document Analysis Client to analyze the PDF
      const blob = new Blob([file.buffer], { type: file.mimetype });
      const poller = await this.documentIntelligenceClient.beginAnalyzeDocument(
        'prebuilt-read',
        await blob.arrayBuffer(),
      );
      const documentIntelligenceResponse: AnalyzeResult = await poller.pollUntilDone();

      // Send extracted data to OpenAI API
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
