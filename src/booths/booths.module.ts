import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoothsService } from './booths.service';
import { BoothsController } from './booths.controller';
import { Booth } from './entities/booth.entity';
import { BoothWifi } from './entities/booth-wifi.entity';
import { BoothReceptionist } from './entities/booth-receptionist.entity';
import { BoothRuleSet } from './entities/booth-rule-set.entity';
import { BoothHoliday } from './entities/booth-holiday.entity';
import { BoothSpecialSchedule } from './entities/booth-special-schedule.entity';
import { AuditModule } from '../audit/audit.module';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module'; // Importa o módulo de autenticação para herdar o JWT
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booth, BoothWifi, BoothReceptionist, BoothRuleSet, BoothHoliday, BoothSpecialSchedule, User]),
    AuthModule, // <-- ESSENCIAL para que o JwtAuthGuard funcione neste controlador
    AuditModule,
    RealtimeModule,
  ],
  controllers: [BoothsController],
  providers: [BoothsService],
  exports: [BoothsService, TypeOrmModule],
})
export class BoothsModule {}