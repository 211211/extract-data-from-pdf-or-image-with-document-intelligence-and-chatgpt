import * as bodyParser from 'body-parser';

import AppConfig, { CONFIG_APP } from './config/app';
import { ConfigService, ConfigType } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  const configService = app.get(ConfigService);
  const appConfig = configService.get<ConfigType<typeof AppConfig>>(CONFIG_APP);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.enableCors({
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  });

  if (appConfig?.basePath) {
    app.setGlobalPrefix(appConfig?.basePath);
  }

  const swaggerOptions = new DocumentBuilder()
    .setTitle('extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt APIs')
    .setDescription('extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt APIs')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerOptions, {
    include: [AppModule],
  });
  SwaggerModule.setup('/swaggers', app, document);
  await app.listen(appConfig?.port ?? 3000, appConfig?.host ?? 'localhost');
  console.debug(`App is listening on ${appConfig?.host}:${appConfig?.port}`);
}

bootstrap();
