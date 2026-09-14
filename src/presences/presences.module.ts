// src/presences/presences.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresencesService } from './presences.service';
import { PresencesController } from './presences.controller';
import { Presence } from './entities/presence.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { BoothHoliday } from '../booths/entities/booth-holiday.entity';
import { BoothSpecialSchedule } from '../booths/entities/booth-special-schedule.entity';
import { DeadManLog } from './entities/dead-man-log.entity';
import { Message } from '../messages/entities/message.entity';
import { MessageRecipient } from '../messages/entities/message-recipient.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { Tenant } from '../tenants/tenant.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Presence, 
      AttendanceRecord,
      User,
      Booth,
      BoothRuleSet,
      BoothHoliday,
      BoothSpecialSchedule,
      DeadManLog, 
      Message,
      MessageRecipient,
      BoothReceptionist,
      Tenant
    ]),
    AuthModule,
  ],
  controllers: [PresencesController],
  providers: [PresencesService],
  exports: [PresencesService],
})
export class PresencesModule {}