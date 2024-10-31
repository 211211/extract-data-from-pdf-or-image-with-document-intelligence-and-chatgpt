import AppConfig, { CONFIG_APP } from '../../../config/app';
import { AzureKeyCredential, DocumentAnalysisClient } from '@azure/ai-form-recognizer';
import { ConfigService, ConfigType } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';

import { HttpService } from '@nestjs/axios';
import OpenAI from 'openai';
import { PdfExtractorDto } from './dto/pdf-extractor.dto';

export const OpenAIInstance = () => {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return client;
};

const textPrompt =
  'Extract all the biomarker output json format as below: [{"biomarker_name": name of the biomarker, "biomarker_value": value of the biomarker, "unit": unit of the biomarker, "reference_range": reference range of the biomarker, "category": category that biomarker belongs to }] If 1 biomarker has multiple values, units and reference ranges, please create corresponding results for that, for example: Input: Haemotalogy Neutrophils 66 % 5.5 x 10^9/L (2.0 - 7.0) Result: [{"biomarker_name": "Neutrophils", "biomarker_value": "66", "unit": "%", "reference_range": "NA", "category": "Haemotalogy" }, {"biomarker_name": "Neutrophils", "biomarker_value": "5.5", "unit": "10^9/L", "reference_range": "(2.0 - 7.0)", "category": "Haemotalogy" }] If reference range is text like Nil, negative, positive..., you must return the format of: reference_range: normal value Biomarkers like Blood Group, Urine Transparency, Colour... should be included if it\'s existed Don\'t be confused by reference range table, and this table is not biomarker You must keep the same text in the image, return the json output only, don\'t include ```json in the response. If you can\'t find the information in the image of any required field, make the default value as \'NA\'. If the value contains unit, try to split it into value and unit Keep all the number as text. Anywhere with None, you must replace by \'NA\'. Don\'t include the unit in the reference_range. Some popular unit is x10^9/L, x10^9g/L, x10^12g/L, x10^12, x10^12 g/L, x10^12/L, x10^6, x10^6 g/L, x10^6/L. For those you should return the unit with the pretty format, for example 10^12 g/L, 10^9/L';

export const DocumentIntelligenceInstance = () => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error('One or more Document Intelligence environment variables are not set');
  }

  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

  return client;
};

const LoadFile = async (file: PdfExtractorDto['file']) => {
  const client = DocumentIntelligenceInstance();

  // Create a Blob from the file buffer
  const blob = new Blob([file.buffer], { type: file.mimetype });

  const poller = await client.beginAnalyzeDocument('prebuilt-read', await blob.arrayBuffer());
  const response = await poller.pollUntilDone();

  return response;
};

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);
  private appConfig: ConfigType<typeof AppConfig>;

  constructor(private readonly configService: ConfigService, private readonly httpService: HttpService) {
    this.appConfig = configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);
  }

  async extract(file: PdfExtractorDto['file']) {
    try {
      const documentIntelligenceResponse = await LoadFile(file);
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
