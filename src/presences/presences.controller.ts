// src/presences/presences.controller.ts
import { Controller, Post, Get, Body, UseGuards, Param, NotFoundException, Query, ForbiddenException } from '@nestjs/common';
import { PresencesService } from './presences.service';
import { CheckInDto } from './dto/check-in.dto';
import { PingResponseDto } from './dto/ping-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('presences')
export class PresencesController {
  constructor(private readonly presencesService: PresencesService) {}

  @Post('check-in')
  @UseGuards(JwtAuthGuard)
  async checkIn(
    @Body() checkInDto: CheckInDto,
    @CurrentUser('sub') brokerId: string,
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.checkIn(checkInDto, brokerId, tenantId);
  }

  @Post('check-out')
  @UseGuards(JwtAuthGuard)
  async checkOut(
    @CurrentUser('sub') brokerId: string,
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.checkOut(brokerId, tenantId);
  }

  @Get('dashboard-summary')
  @UseGuards(JwtAuthGuard)
  async getBrokerDashboardSummary(
    @CurrentUser('sub') brokerId: string,
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.getBrokerDashboardSummary(brokerId, tenantId);
  }

  @Get('team-eligibility')
  @UseGuards(JwtAuthGuard)
  async getTeamWeekendEligibility(
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.getTeamWeekendEligibility(currentUser, tenantId);
  }

  @Get('current')
  @UseGuards(JwtAuthGuard)
  async getCurrentPresence(
    @CurrentUser('sub') brokerId: string,
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.getCurrentPresence(brokerId, tenantId);
  }

  // 1. Rota para o corretor responder ao ping de confirmação periódico [8]
  @Post('ping-response')
  @UseGuards(JwtAuthGuard)
  async respondToPing(
    @Body() pingResponseDto: PingResponseDto,
    @CurrentUser('sub') brokerId: string,
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.respondToPing(pingResponseDto, brokerId, tenantId);
  }

  // 2. ROTA EXCLUSIVA DE TESTES (PÚBLICA): Força a execução manual do motor de pings [8]
  // (Para que você não precise aguardar os 30 minutos em desenvolvimento)
  @Post('test-trigger-pings')
  @UseGuards(JwtAuthGuard)
  async triggerPingsManual() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return this.presencesService.processPresencesAndPings();
  }

  // 1. Rota de Auditoria Mensal do Corretor (GET /presences/statistics/broker/:brokerId) [6]
  @Get('statistics/broker/:brokerId')
  @UseGuards(JwtAuthGuard)
  async getBrokerStatistics(
    @Param('brokerId') brokerId: string,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('boothId') boothId?: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria pode consultar o BI de assiduidade.');
    }
    const activeMonth = month ? Number(month) : new Date().getMonth() + 1;
    const activeYear = year ? Number(year) : new Date().getFullYear();
    return this.presencesService.getBrokerMonthlyStatistics(brokerId, tenantId, activeMonth, activeYear, boothId);
  }

  // 2. Rota de Score de Plantão / Mapa de Calor de Demanda (GET /presences/statistics/booth-demand/:boothId) [6]
  @Get('statistics/booth-demand/:boothId')
  @UseGuards(JwtAuthGuard)
  async getBoothDemandHeatmap(
    @Param('boothId') boothId: string,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria pode consultar o BI de demanda.');
    }
    return this.presencesService.getBoothDemandHeatmap(boothId, tenantId);
  }

  @Post('force-check-in')
  @UseGuards(JwtAuthGuard)
  async forceCheckIn(
    @Body() dto: { brokerId?: string; boothId?: string; roletaPosition?: number },
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.presencesService.forceCheckIn(currentUser, tenantId, dto);
  }
}