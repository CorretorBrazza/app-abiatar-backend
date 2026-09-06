import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { Presence } from '../presences/entities/presence.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { PushDeviceToken } from '../notifications/entities/push-device-token.entity';
import { DevService } from './dev.service';
import { DevController } from './dev.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      User,
      Booth,
      Presence,
      AuditLog,
      PushDeviceToken,
    ]),
  ],
  controllers: [DevController],
  providers: [DevService],
  exports: [DevService],
})
export class DevModule {}
