import { AzureKeyCredential } from '@azure/core-auth';
import ModelClient from '@azure-rest/ai-inference';

export const AzureOpenAIEmbeddingInstance = () => {
  //aoa-zeu2-gpt-prd.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2023-05-15
  const endpoint = `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME}`;
  const apiKey = process.env.AZURE_OPENAI_API_KEY!;
  const apiVersion = '2023-05-15';

  const client = ModelClient(endpoint, new AzureKeyCredential(apiKey), {
    apiVersion: apiVersion,
  });

  return client;
};
