// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule'; // <-- ADICIONE ESTA LINHA

import { Tenant } from './tenants/tenant.entity';
import { User } from './users/user.entity';
import { AuthModule } from './auth/auth.module';
import { Booth } from './booths/entities/booth.entity';
import { BoothWifi } from './booths/entities/booth-wifi.entity';
import { BoothsModule } from './booths/booths.module';
import { OnboardingLink } from './users/entities/onboarding-link.entity';
import { UsersModule } from './users/users.module';
import { Presence } from './presences/entities/presence.entity';
import { DeadManLog } from './presences/entities/dead-man-log.entity'; // <-- ADICIONE ESTA LINHA
import { PresencesModule } from './presences/presences.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // <-- ADICIONE ESTA LINHA para habilitar as tarefas agendadas em segundo plano
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, User, Booth, BoothWifi, OnboardingLink, Presence, DeadManLog], // <-- ADICIONE "DeadManLog" AQUI
      synchronize: true,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    AuthModule,
    BoothsModule,
    UsersModule,
    PresencesModule,
  ],
})
export class AppModule {}