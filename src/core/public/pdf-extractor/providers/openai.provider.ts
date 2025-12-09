import OpenAI from 'openai';

export const OpenAIInstance = () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.log('[OpenAIInstance] OpenAI provider disabled - OPENAI_API_KEY not set');
    return null;
  }

  return new OpenAI({
    apiKey: apiKey,
  });
};

export const AzureOpenAIInstance = () => {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const baseUrl = process.env.AZURE_OPENAI_API_BASE_URL;

  if (!apiKey || !baseUrl) {
    console.log(
      '[AzureOpenAIInstance] Azure OpenAI provider disabled - AZURE_OPENAI_API_KEY or AZURE_OPENAI_API_BASE_URL not set',
    );
    return null;
  }

  return new OpenAI({
    apiKey: apiKey,
    baseURL: baseUrl,
  });
};
