// src/notifications/notifications.module.ts
import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Global() // Torna o módulo global em todo o projeto
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService], // Exporta o serviço para uso global
})
export class NotificationsModule {}
