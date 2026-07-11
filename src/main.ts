// src/main.ts
import * as dotenv from 'dotenv'; // <-- ADICIONE ESTA LINHA NA LINHA 1
dotenv.config();                // <-- ADICIONE ESTA LINHA NA LINHA 2

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT || 3000);
}
bootstrap();