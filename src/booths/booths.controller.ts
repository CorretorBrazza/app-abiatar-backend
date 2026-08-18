// src/booths/booths.controller.ts
import { Controller, Post, Get, Patch, Delete, Param, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { BoothsService } from './booths.service';
import { CreateBoothDto } from './dto/create-booth.dto';
import { UpdateBoothRulesDto } from './dto/update-booth-rules.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('booths')
@UseGuards(JwtAuthGuard) // Protege todas as rotas do controlador exigindo Token JWT Bearer
export class BoothsController {
  constructor(private readonly boothsService: BoothsService) {}

  @Post()
  async create(@Body() createBoothDto: CreateBoothDto, @TenantId() tenantId: string) {
    return this.boothsService.create(createBoothDto, tenantId);
  }

  @Get()
  async findAll(@TenantId() tenantId: string) {
    return this.boothsService.findAll(tenantId);
  }

  @Get('assigned')
  async findAssigned(
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'recepcao_level_3') {
      throw new ForbiddenException('Somente a Recepção pode consultar seus plantões atribuídos.');
    }
    return this.boothsService.listAssignedToReceptionist(currentUser.sub, tenantId);
  }

  @Post(':boothId/receptionists/:receptionistId')
  async assignReceptionist(
    @Param('boothId') boothId: string,
    @Param('receptionistId') receptionistId: string,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Somente a Diretoria pode atribuir recepcionistas a plantões.');
    }
    return this.boothsService.assignReceptionist(boothId, receptionistId, tenantId);
  }

  @Get(':boothId/receptionists')
  async listReceptionists(
    @Param('boothId') boothId: string,
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.listReceptionists(boothId, tenantId);
  }

  @Delete(':boothId/receptionists/:receptionistId')
  async removeReceptionist(
    @Param('boothId') boothId: string,
    @Param('receptionistId') receptionistId: string,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Somente a Diretoria pode remover recepcionistas de plantões.');
    }
    return this.boothsService.removeReceptionist(boothId, receptionistId, tenantId);
  }

  @Get(':boothId/rules')
  async getRules(
    @Param('boothId') boothId: string,
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.getActiveRuleSet(boothId, tenantId);
  }

  @Patch(':boothId/rules')
  async updateRules(
    @Param('boothId') boothId: string,
    @Body() dto: UpdateBoothRulesDto,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.updateRuleSet(boothId, tenantId, {
      id: currentUser.sub,
      role: currentUser.role,
      email: currentUser.email,
    }, dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.boothsService.findOne(id, tenantId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.boothsService.remove(id, tenantId);
  }
}