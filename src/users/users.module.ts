// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './user.entity';
import { OnboardingLink } from './entities/onboarding-link.entity';
import { Tenant } from '../tenants/tenant.entity';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module'; // Importa para herdar a validação do JWT

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OnboardingLink, Tenant]),
    AuthModule,
    AuditModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // Exporta se outros módulos precisarem buscar usuários
})
export class UsersModule {}