// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenants/tenant.entity';
import { User } from './users/user.entity';
import { AuthModule } from './auth/auth.module'; // <-- IMPORTAÇÃO DO NOVO MÓDULO

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, User],
      synchronize: true, // Garante sincronização das tabelas no banco de dados
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    AuthModule, // <-- ADICIONADO AO ARRAY DE IMPORTS
  ],
})
export class AppModule {}