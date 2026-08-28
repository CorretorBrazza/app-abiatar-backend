// src/notifications/notifications.module.ts
import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Presence } from '../presences/entities/presence.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';
import { PushDeviceToken } from './entities/push-device-token.entity';
import { NotificationsController } from './notifications.controller';
import { AuthModule } from '../auth/auth.module';

@Global() // Torna o módulo global em todo o projeto
@Module({
  imports: [
    TypeOrmModule.forFeature([PushDeviceToken, User, Tenant, Presence, BoothReceptionist]),
    AuthModule,
    AuditModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailService],
  exports: [NotificationsService, EmailService], // Exporta o serviço para uso global
})
export class NotificationsModule {}
