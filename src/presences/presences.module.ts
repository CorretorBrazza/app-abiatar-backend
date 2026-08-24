// src/presences/presences.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PresencesService } from './presences.service';
import { PresencesController } from './presences.controller';
import { Presence } from './entities/presence.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { BoothHoliday } from '../booths/entities/booth-holiday.entity';
import { BoothSpecialSchedule } from '../booths/entities/booth-special-schedule.entity';
import { DeadManLog } from './entities/dead-man-log.entity';
import { Message } from '../messages/entities/message.entity'; // <-- ADICIONE ESTA IMPORTAÇÃO
import { MessageRecipient } from '../messages/entities/message-recipient.entity'; // <-- ADICIONE ESTA IMPORTAÇÃO
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Presence, 
      Booth,
      BoothRuleSet,
      BoothHoliday,
      BoothSpecialSchedule,
      DeadManLog, 
      Message, // <-- ADICIONADO PARA LIBERAR A INJEÇÃO DE DEPENDÊNCIA
      MessageRecipient // <-- ADICIONADO PARA LIBERAR A INJEÇÃO DE DEPENDÊNCIA
    ]),
    AuthModule,
  ],
  controllers: [PresencesController],
  providers: [PresencesService],
})
export class PresencesModule {}