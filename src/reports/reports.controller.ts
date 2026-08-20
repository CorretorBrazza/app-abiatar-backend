import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('weekly-periods')
  async getWeeklyPeriods(
    @TenantId() tenantId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @Query('weekStart') weekStart?: string,
  ) {
    return this.reportsService.getWeeklyReport(tenantId, currentUser, weekStart);
  }

  @Get('weekly-periods/close')
  async closeWeeklyPeriods(
    @TenantId() tenantId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @Query('weekStart') weekStart?: string,
  ) {
    return this.reportsService.closeWeeklyReport(tenantId, currentUser, weekStart);
  }
}
