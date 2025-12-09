import { AzureKeyCredential } from '@azure/core-auth';
import ModelClient from '@azure-rest/ai-inference';

export const AzureOpenAIEmbeddingInstance = () => {
  const instanceName = process.env.AZURE_OPENAI_API_INSTANCE_NAME;
  const embeddingsDeployment = process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!instanceName || !embeddingsDeployment || !apiKey) {
    console.log('[AzureOpenAIEmbeddingInstance] Embedding provider disabled - missing required config');
    return null;
  }

  const endpoint = `https://${instanceName}.openai.azure.com/openai/deployments/${embeddingsDeployment}`;
  const apiVersion = '2023-05-15';

  const client = ModelClient(endpoint, new AzureKeyCredential(apiKey), {
    apiVersion: apiVersion,
  });

  return client;
};
