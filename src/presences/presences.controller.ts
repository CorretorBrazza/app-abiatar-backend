// src/presences/presences.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { PresencesService } from './presences.service';
import { CheckInDto } from './dto/check-in.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('presences')
@UseGuards(JwtAuthGuard) // Exige token JWT Bearer ativo para qualquer check-in
export class PresencesController {
  constructor(private readonly presencesService: PresencesService) {}

  @Post('check-in')
  async checkIn(
    @Body() checkInDto: CheckInDto,
    @CurrentUser('sub') brokerId: string, // Captura o ID do corretor logado do token
    @TenantId() tenantId: string, // Captura o ID da construtora do token
  ) {
    return this.presencesService.checkIn(checkInDto, brokerId, tenantId);
  }
}