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

export const AzureOpenAIInstance = () => {
  const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME}`,
    defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
  });
  return openai;
};
