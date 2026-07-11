// src/presences/presences.controller.ts
import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
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
  async triggerPingsManual() {
    return this.presencesService.processPresencesAndPings();
  }
}