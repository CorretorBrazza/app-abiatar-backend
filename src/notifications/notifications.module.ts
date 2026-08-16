// src/notifications/notifications.module.ts
import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { PushDeviceToken } from './entities/push-device-token.entity';
import { NotificationsController } from './notifications.controller';

@Global() // Torna o módulo global em todo o projeto
@Module({
  imports: [TypeOrmModule.forFeature([PushDeviceToken])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService], // Exporta o serviço para uso global
})
export class NotificationsModule {}
