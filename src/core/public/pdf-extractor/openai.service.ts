import OpenAI from 'openai';

export const OpenAIInstance = () => {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};
