import OpenAI from 'openai';

export const OpenAIInstance = (): OpenAI => {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};
