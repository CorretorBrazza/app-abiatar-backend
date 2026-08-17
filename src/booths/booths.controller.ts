// src/booths/booths.controller.ts
import { Controller, Post, Get, Delete, Param, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { BoothsService } from './booths.service';
import { CreateBoothDto } from './dto/create-booth.dto';
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

  @Get(':id')
  async findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.boothsService.findOne(id, tenantId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.boothsService.remove(id, tenantId);
  }
}