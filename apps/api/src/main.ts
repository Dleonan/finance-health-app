import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { allowedCorsOrigins } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('v1');
  app.use(helmet());
  app.use(json({ limit: '64kb' }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const origins = allowedCorsOrigins(config);
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed'), false);
    },
    credentials: false,
  });

  await app.listen(config.get<number>('PORT', 3000), config.get<string>('HOST', '0.0.0.0'));
}

void bootstrap();
