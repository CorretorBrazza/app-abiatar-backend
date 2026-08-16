// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { Tenant } from './tenants/tenant.entity';
import { User } from './users/user.entity';
import { AuthModule } from './auth/auth.module';
import { Booth } from './booths/entities/booth.entity';
import { BoothWifi } from './booths/entities/booth-wifi.entity';
import { BoothsModule } from './booths/booths.module';
import { OnboardingLink } from './users/entities/onboarding-link.entity';
import { UsersModule } from './users/users.module';
import { Presence } from './presences/entities/presence.entity';
import { DeadManLog } from './presences/entities/dead-man-log.entity';
import { PresencesModule } from './presences/presences.module';
import { Message } from './messages/entities/message.entity';
import { MessageRecipient } from './messages/entities/message-recipient.entity';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushDeviceToken } from './notifications/entities/push-device-token.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [
        Tenant, 
        User, 
        Booth, 
        BoothWifi, 
        OnboardingLink, 
        Presence, 
        DeadManLog, 
        Message,
        MessageRecipient,
        PushDeviceToken,
      ],
      synchronize: process.env.NODE_ENV !== 'production' && process.env.TYPEORM_SYNCHRONIZE !== 'false',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    AuthModule,
    BoothsModule,
    UsersModule,
    PresencesModule,
    MessagesModule,
    NotificationsModule, // <-- ADICIONE ESTA LINHA AO ARRAY
  ],
})
export class AppModule {}