// src/booths/booths.controller.ts
import { Controller, Post, Get, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { BoothsService } from './booths.service';
import { CreateBoothDto } from './dto/create-booth.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

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

  @Get(':id')
  async findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.boothsService.findOne(id, tenantId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.boothsService.remove(id, tenantId);
  }
}