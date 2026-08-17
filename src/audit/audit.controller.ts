import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @TenantId() tenantId: string,
    @CurrentUser() currentUser: { role: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      return { data: [], total: 0, page: 1, limit: 0 };
    }

    return this.auditService.listForTenant(tenantId, {
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 100),
      action,
    });
  }
}
