// import { Injectable, Inject, Logger } from '@nestjs/common';
// import OpenAI from 'openai';
// import { ICompletionService } from '../interfaces/completion.interface';
// import { textPrompt } from '../prompt';

// @Injectable()
// export class CompletionService implements ICompletionService {
//   private readonly logger = new Logger(CompletionService.name);

//   constructor(
//     @Inject('OpenAIClient') private readonly openAIClient: OpenAI, // Injecting OpenAI client here
//   ) {}

//   async chatCompletion(analysisResult: any): Promise<string> {
//     const gptResponse = await this.openAIClient.chat.completions.create({
//       model: 'gpt-4o',
//       messages: [
//         { role: 'system', content: textPrompt },
//         { role: 'user', content: JSON.stringify(analysisResult) },
//       ],
//       temperature: 0,
//       max_tokens: 4096,
//     });
//     return gptResponse.choices[0].message.content;
//   }
// }

import { Injectable, Inject, Logger } from '@nestjs/common';
import { ICompletionService } from '../interfaces/completion.interface';
import { textPrompt } from '../prompt';
import { ModelClient } from '@azure-rest/ai-inference';

@Injectable()
export class CompletionService implements ICompletionService {
  private readonly logger = new Logger(CompletionService.name);

  constructor(@Inject('ModelClient') private readonly aiClient: ModelClient) {}

  async chatCompletion(analysisResult: any): Promise<string> {
    try {
      this.logger.log('Initiating chat completion with Grok');
      const response = await this.aiClient.path('/chat/completions').post({
        body: {
          model: process.env.AZURE_AI_FOUNDRY_MODEL_NAME || 'grok-3-mini',
          messages: [
            { role: 'system', content: textPrompt },
            { role: 'user', content: JSON.stringify(analysisResult) },
          ],
        },
      });

      if (response.status !== '200') {
        this.logger.error(`Grok API error: ${response.status}`);
        throw new Error(`Grok API returned status ${response.status}`);
      }

      // Type guard to ensure response.body has 'choices'
      if ('choices' in response.body && Array.isArray(response.body.choices) && response.body.choices.length > 0) {
        const content = response.body.choices[0].message.content;
        this.logger.log('Successfully received response from Grok');
        return content || '';
      } else {
        this.logger.error('Grok API response does not contain choices');
        throw new Error('Grok API response does not contain choices');
      }
    } catch (error) {
      this.logger.error(`Error in chat completion: ${error.message}`);
      throw error;
    }
  }
}
