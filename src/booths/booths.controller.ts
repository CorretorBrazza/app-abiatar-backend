import { Controller, Post, Get, Patch, Delete, Param, Body, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { BoothsService } from './booths.service';
import { CreateBoothDto } from './dto/create-booth.dto';
import { UpdateBoothRulesDto } from './dto/update-booth-rules.dto';
import { UpdateBoothDto } from './dto/update-booth.dto';
import { CreateBoothHolidayDto } from './dto/create-booth-holiday.dto';
import { CreateSpecialScheduleDto } from './dto/create-special-schedule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('booths')
@UseGuards(JwtAuthGuard) // Protege todas as rotas do controlador exigindo Token JWT Bearer
export class BoothsController {
  constructor(private readonly boothsService: BoothsService) {}

  @Post('special-schedules')
  async createSpecialScheduleRoot(
    @Body() dto: CreateSpecialScheduleDto,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    if (!dto.boothId) {
      throw new BadRequestException('boothId é obrigatório para cadastrar horário especial.');
    }
    return this.boothsService.createSpecialSchedule(dto.boothId, dto, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, tenantId);
  }

  @Post(':boothId/special-schedules')
  async createSpecialSchedule(
    @Param('boothId') boothId: string,
    @Body() dto: CreateSpecialScheduleDto,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.createSpecialSchedule(boothId, dto, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, tenantId);
  }

  @Get('special-schedules/:boothId')
  async listSpecialSchedulesByParam(
    @Param('boothId') boothId: string,
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.listSpecialSchedules(boothId, tenantId);
  }

  @Get(':boothId/special-schedules')
  async listSpecialSchedules(
    @Param('boothId') boothId: string,
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.listSpecialSchedules(boothId, tenantId);
  }

  @Delete('special-schedules/:scheduleId')
  async deleteSpecialSchedule(
    @Param('scheduleId') scheduleId: string,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.deleteSpecialSchedule(scheduleId, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, tenantId);
  }

  @Post('holidays')
  async createHoliday(
    @Body() dto: CreateBoothHolidayDto,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1' && currentUser.role !== 'platform_admin_level_0') {
      throw new ForbiddenException('Somente a Diretoria pode cadastrar feriados.');
    }
    return this.boothsService.createHoliday(dto, tenantId, {
      id: currentUser.sub,
      role: currentUser.role,
      email: currentUser.email,
    });
  }

  @Get('holidays')
  async listHolidays(@TenantId() tenantId: string) {
    return this.boothsService.listHolidays(tenantId);
  }

  @Delete('holidays/:id')
  async deleteHoliday(
    @Param('id') holidayId: string,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1' && currentUser.role !== 'platform_admin_level_0') {
      throw new ForbiddenException('Somente a Diretoria pode excluir feriados.');
    }
    return this.boothsService.deleteHoliday(holidayId, tenantId, {
      id: currentUser.sub,
      role: currentUser.role,
      email: currentUser.email,
    });
  }

  @Post()
  async create(@Body() createBoothDto: CreateBoothDto, @CurrentUser() currentUser: { role: string }, @TenantId() tenantId: string) {
    if (currentUser.role !== 'diretoria_level_1' && currentUser.role !== 'platform_admin_level_0') {
      throw new ForbiddenException('Somente a Diretoria pode cadastrar plantões.');
    }
    return this.boothsService.create(createBoothDto, tenantId);
  }

  @Get()
  async findAll(@TenantId() tenantId: string, @CurrentUser() currentUser: { role: string }) {
    return this.boothsService.findAll(tenantId, currentUser.role);
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
      throw new ForbiddenException('Somente a Diretoria pode atribuir Recepção a plantões.');
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
      throw new ForbiddenException('Somente a Diretoria pode remover Recepção de plantões.');
    }
    return this.boothsService.removeReceptionist(boothId, receptionistId, tenantId);
  }

  @Patch(':boothId')
  async updateBooth(
    @Param('boothId') boothId: string,
    @Body() dto: UpdateBoothDto,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.updateBooth(boothId, tenantId, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, dto);
  }

  @Post(':boothId/publish')
  async publishBooth(
    @Param('boothId') boothId: string,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.changeLifecycle(boothId, tenantId, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, 'publish');
  }

  @Post(':boothId/pause')
  async pauseBooth(
    @Param('boothId') boothId: string,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.changeLifecycle(boothId, tenantId, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, 'pause');
  }

  @Post(':boothId/archive')
  async archiveBooth(
    @Param('boothId') boothId: string,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.boothsService.changeLifecycle(boothId, tenantId, { id: currentUser.sub, role: currentUser.role, email: currentUser.email }, 'archive');
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
  async remove(@Param('id') id: string, @CurrentUser() currentUser: { role: string }, @TenantId() tenantId: string) {
    if (currentUser.role !== 'diretoria_level_1' && currentUser.role !== 'platform_admin_level_0') {
      throw new ForbiddenException('Somente a Diretoria pode excluir plantões.');
    }
    return this.boothsService.remove(id, tenantId);
  }
}