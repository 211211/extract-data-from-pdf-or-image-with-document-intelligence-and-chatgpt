import { registerAs } from '@nestjs/config';

export const CONFIG_APP = 'app';

export default registerAs(CONFIG_APP, () => ({
  name: String(process.env.APP_NAME),
  version: String(process.env.APP_VERSION),
  host: String(process.env.APP_HOST),
  port: Number(process.env.APP_PORT),
  basePath: String(process.env.APP_BASE_PATH),
  OPENAI_API_KEY: String(process.env.OPENAI_API_KEY),
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT),
  AZURE_DOCUMENT_INTELLIGENCE_KEY: String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY),
  aws: {
    region: 'a',
  },
}));
