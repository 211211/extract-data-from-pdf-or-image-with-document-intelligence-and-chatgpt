import OpenAI from 'openai';

export const OpenAIInstance = () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key environment variable is missing');
  }

  return new OpenAI({
    apiKey: apiKey,
  });
};
