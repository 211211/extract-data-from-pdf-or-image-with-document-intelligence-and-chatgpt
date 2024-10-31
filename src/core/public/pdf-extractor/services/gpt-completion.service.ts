import { Injectable, Inject, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { IGptCompletionService } from '../interfaces/gpt-completion.interface';
import { textPrompt } from '../prompt';

@Injectable()
export class GptCompletionService implements IGptCompletionService {
  private readonly logger = new Logger(GptCompletionService.name);

  constructor(
    @Inject('OpenAIClient') private readonly openAIClient: OpenAI, // Injecting OpenAI client here
  ) {}

  async completeWithGPT(analysisResult: any): Promise<string> {
    try {
      const gptResponse = await this.openAIClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: textPrompt },
          { role: 'user', content: JSON.stringify(analysisResult) },
        ],
        temperature: 0,
        max_tokens: 4096,
      });
      return gptResponse.choices[0].message.content;
    } catch (error) {
      this.logger.error('Failed to complete with GPT', error instanceof Error ? error.message : error);
      throw error;
    }
  }
}
