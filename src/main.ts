// src/main.ts
import * as dotenv from 'dotenv'; // <-- ADICIONE ESTA LINHA NA LINHA 1
dotenv.config();                // <-- ADICIONE ESTA LINHA NA LINHA 2

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    for (const variable of ['DATABASE_URL', 'JWT_SECRET']) {
      if (!process.env[variable]) {
        throw new Error(`Variável obrigatória ausente: ${variable}`);
      }
    }
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.warn('[CONFIG] Aviso: FIREBASE_SERVICE_ACCOUNT não configurada. Push funcionará em modo fallback.');
    }
  }

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8081,http://localhost:19006')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: false });
  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}
bootstrap();