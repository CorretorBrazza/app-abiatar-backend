// src/users/users.controller.ts
import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { CreateReceptionistDto } from './dto/create-receptionist.dto';
import { CreateOnboardingLinkDto } from './dto/create-onboarding-link.dto';
import { RegisterManagerDto } from './dto/register-manager.dto';
import { TransferBrokerDto, UpdateBrokerLeadPauseDto, UpdateBrokerProfileDto } from './dto/update-broker-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator'; // (Opcional - criaremos na sequência se necessário, ou usamos request.user)

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private resolveManagerId(
    requestedManagerId: string,
    currentUser: { sub: string; role: string },
  ): string {
    if (!['diretoria_level_1', 'gerencia_level_2'].includes(currentUser.role)) {
      throw new ForbiddenException('Apenas diretoria ou gerência podem acessar esta operação.');
    }
    if (currentUser.role === 'gerencia_level_2' && requestedManagerId !== currentUser.sub) {
      throw new ForbiddenException('A gerência só pode acessar a própria equipe.');
    }
    return requestedManagerId;
  }

  // Diretoria cria um gerente dentro do próprio tenant (ROTA PROTEGIDA)
  @Post('managers')
  @UseGuards(JwtAuthGuard)
  async createManager(
    @Body() createManagerDto: CreateManagerDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Apenas a diretoria pode criar gerentes.');
    }
    return this.usersService.createManager(createManagerDto, tenantId);
  }

  @Post('receptionists')
  @UseGuards(JwtAuthGuard)
  async createReceptionist(
    @Body() createReceptionistDto: CreateReceptionistDto,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Apenas a Diretoria pode criar Recepção.');
    }
    return this.usersService.createReceptionist(createReceptionistDto, tenantId);
  }

  // 1. Corretor se cadastra (ROTA PÚBLICA - Sem Guard de segurança) [10]
  @Post('register-broker')
  async registerBroker(@Body() registerBrokerDto: RegisterBrokerDto) {
    return this.usersService.registerBroker(registerBrokerDto);
  }

  @Get('onboarding-link/:token')
  async getOnboardingInviteInfo(@Param('token') token: string) {
    return this.usersService.getOnboardingInviteInfo(token);
  }

  @Get('management-users')
  @UseGuards(JwtAuthGuard)
  async listManagementUsers(
    @Query('role') role: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Somente a Diretoria pode consultar os cards de Gerentes e Recepção.');
    }
    if (!['gerencia_level_2', 'recepcao_level_3'].includes(role)) {
      throw new ForbiddenException('Perfil de gestão inválido.');
    }
    return this.usersService.listManagementUsers(role, tenantId);
  }

  @Get('management-user/:id')
  @UseGuards(JwtAuthGuard)
  async getManagementUser(
    @Param('id') userId: string,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Somente a Diretoria pode abrir estes cards.');
    }
    return this.usersService.getManagementUser(userId, tenantId);
  }

  @Patch('management-user/:id')
  @UseGuards(JwtAuthGuard)
  async updateManagementUser(
    @Param('id') userId: string,
    @Body() dto: { name?: string; nomeGuerra?: string },
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Somente a Diretoria pode editar estes cards.');
    }
    return this.usersService.updateManagementUser(userId, dto, tenantId);
  }

  @Delete('management-user/:id')
  @UseGuards(JwtAuthGuard)
  async removeManagementUser(
    @Param('id') userId: string,
    @Body() body: { reason?: string },
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'diretoria_level_1') {
      throw new ForbiddenException('Somente a Diretoria pode excluir Gerentes ou Recepção.');
    }
    return this.usersService.removeManagementUser(userId, body?.reason || 'Exclusão solicitada pela Diretoria', currentUser, tenantId);
  }

  @Get('managers/active')
  @UseGuards(JwtAuthGuard)
  async listActiveManagers(@CurrentUser() currentUser: { role: string }, @TenantId() tenantId: string) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria pode consultar a base de gerentes para convites.');
    }
    return this.usersService.listActiveManagers(tenantId);
  }

  // Cria convite de Gerente ou Corretor com vínculo hierárquico obrigatório.
  @Post('onboarding-link')
  @UseGuards(JwtAuthGuard)
  async createOnboardingLink(
    @Body() dto: CreateOnboardingLinkDto,
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.createOnboardingLink({ id: currentUser.sub, role: currentUser.role, email: currentUser.email }, tenantId, dto);
  }

  @Post('register-manager')
  async registerManager(@Body() dto: RegisterManagerDto) {
    return this.usersService.registerManager(dto);
  }

  // 3. Gerente lista os corretores pendentes do seu time (ROTA PROTEGIDA) [10]
  @Get('pending/:managerId')
  @UseGuards(JwtAuthGuard)
  async findPendingApprovals(
    @Param('managerId') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role === 'diretoria_level_1' || currentUser.role === 'platform_admin_level_0') {
      return this.usersService.findPendingApprovals(null, tenantId);
    }
    const effectiveManagerId = this.resolveManagerId(managerId, currentUser);
    return this.usersService.findPendingApprovals(effectiveManagerId, tenantId);
  }

  // 4. Gerente aprova o corretor definindo a carência (ROTA PROTEGIDA) [10, 11]
  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approveBroker(
    @Param('id') brokerId: string,
    @Body() approveBrokerDto: ApproveBrokerDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (currentUser.role !== 'gerencia_level_2') {
      throw new ForbiddenException('Somente a Gerência responsável pode aprovar Corretores.');
    }
    return this.usersService.approveBroker(brokerId, approveBrokerDto, currentUser, tenantId);
  }

  // 5. Gerente lista seu time ativo e em carência (ROTA PROTEGIDA) [10]
  @Get('team/:managerId')
  @UseGuards(JwtAuthGuard)
  async findTeam(
    @Param('managerId') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    const effectiveManagerId = this.resolveManagerId(managerId, currentUser);
    return this.usersService.findTeam(effectiveManagerId, tenantId);
  }

  @Get(':id/management-profile')
  @UseGuards(JwtAuthGuard)
  async getBrokerManagementProfile(
    @Param('id') brokerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.getBrokerManagementProfile(brokerId, currentUser, tenantId);
  }

  @Patch(':id/management-profile')
  @UseGuards(JwtAuthGuard)
  async updateBrokerProfile(
    @Param('id') brokerId: string,
    @Body() dto: UpdateBrokerProfileDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.updateBrokerProfile(brokerId, dto, currentUser, tenantId);
  }

  @Patch(':id/leads-pause')
  @UseGuards(JwtAuthGuard)
  async pauseBrokerLeads(
    @Param('id') brokerId: string,
    @Body() dto: UpdateBrokerLeadPauseDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.setBrokerLeadPause(brokerId, true, dto, currentUser, tenantId);
  }

  @Patch(':id/leads-resume')
  @UseGuards(JwtAuthGuard)
  async resumeBrokerLeads(
    @Param('id') brokerId: string,
    @Body() dto: UpdateBrokerLeadPauseDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.setBrokerLeadPause(brokerId, false, dto, currentUser, tenantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async removeBroker(
    @Param('id') brokerId: string,
    @Body() body: { reason?: string },
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.removeBroker(brokerId, body?.reason || 'Removido pela gestão', currentUser, tenantId);
  }

  @Patch(':id/transfer')
  @UseGuards(JwtAuthGuard)
  async transferBroker(
    @Param('id') brokerId: string,
    @Body() dto: TransferBrokerDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.transferBroker(brokerId, dto, currentUser, tenantId);
  }

  // ROTA EXCLUSIVA DE TESTES (PÚBLICA): Força o encerramento de carências e ativação imediata [10]
  @Post('test-trigger-carencia')
  @UseGuards(JwtAuthGuard)
  async triggerCarenciaManual() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return this.usersService.processCarenciaExpirations();
  }
  // Adicione esta rota dentro da classe UsersController, em src/users/users.controller.ts

  // Rota para o Gestor de Leads consultar a fila de distribuição ao vivo (ROTA PROTEGIDA) [6]
  @Get('leads-queue')
  @UseGuards(JwtAuthGuard)
  async getRealTimeLeadsQueue(@TenantId() tenantId: string) {
    return this.usersService.getRealTimeLeadsQueue(tenantId);
  }
}