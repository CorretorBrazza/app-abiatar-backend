// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenants/tenant.entity';
import { User } from './users/user.entity';
import { AuthModule } from './auth/auth.module';
import { Booth } from './booths/entities/booth.entity'; // <-- ADICIONE ESTA LINHA
import { BoothWifi } from './booths/entities/booth-wifi.entity'; // <-- ADICIONE ESTA LINHA
import { BoothsModule } from './booths/booths.module'; // <-- ADICIONE ESTA LINHA
import { OnboardingLink } from './users/entities/onboarding-link.entity'; // <-- ADICIONE ESTA LINHA
import { UsersModule } from './users/users.module'; // <-- ADICIONE ESTA LINHA
import { Presence } from './presences/entities/presence.entity'; // <-- ADICIONE ESTA LINHA
import { PresencesModule } from './presences/presences.module'; // <-- ADICIONE ESTA LINHA





@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, User, Booth, BoothWifi, OnboardingLink, Presence], // <-- ATUALIZE ESTE ARRAY
      synchronize: true,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    AuthModule,
    BoothsModule, // <-- ADICIONE ESTA LINHA AO ARRAY
    UsersModule, // <-- ADICIONE ESTA LINHA AO ARRAY
    PresencesModule, // <-- ADICIONE ESTA LINHA AO ARRAY
  ],
})
export class AppModule {}