import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { WeeklyPeriodReport } from './entities/weekly-period-report.entity';
import { WeeklyPeriodReportItem } from './entities/weekly-period-report-item.entity';
import { Presence } from '../presences/entities/presence.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([WeeklyPeriodReport, WeeklyPeriodReportItem, Presence, User, Booth, BoothRuleSet, BoothReceptionist]), AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
