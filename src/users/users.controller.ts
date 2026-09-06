// src/users/users.controller.ts
import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { CreateReceptionistDto } from './dto/create-receptionist.dto';
import { CreateOnboardingLinkDto } from './dto/create-onboarding-link.dto';
import { RegisterManagerDto } from './dto/register-manager.dto';
import { TransferBrokerDto, UpdateBrokerLeadPauseDto, UpdateBrokerProfileDto, UpdateBrokerStageDto } from './dto/update-broker-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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

  // Lista gerentes ativos para a tela pública de cadastro (SEM GUARD DE AUTENTICAÇÃO)
  @Get('public-managers')
  async getPublicManagers(@Query('tenantSlug') tenantSlug?: string) {
    return this.usersService.getPublicManagers(tenantSlug);
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
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      throw new ForbiddenException('Apenas a Diretoria pode criar Recepção.');
    }
    return this.usersService.createReceptionist(createReceptionistDto, tenantId);
  }

  @Post('rh')
  @UseGuards(JwtAuthGuard)
  async createRhUser(
    @Body() dto: CreateManagerDto,
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      throw new ForbiddenException('Apenas a Diretoria pode criar usuários de RH.');
    }
    return this.usersService.createRhUser(dto, tenantId);
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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria pode consultar os cards de Gerentes, Recepção e RH.');
    }
    if (!['gerencia_level_2', 'recepcao_level_3', 'rh_level_2', 'rh_level_1'].includes(role)) {
      throw new ForbiddenException('Perfil de gestão inválido.');
    }
    return this.usersService.listManagementUsers(role, tenantId, { page: Number(page), pageSize: Number(pageSize), search, status });
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
    @Body() dto: { name?: string; nomeGuerra?: string; email?: string; password?: string; mustChangePassword?: boolean },
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(currentUser.role)) {
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
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria e RH podem consultar a base de gerentes para convites.');
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

  // Triagem do RH / Diretoria: Lista corretores pendentes de validação documental
  @Get('pending-hr-review')
  @UseGuards(JwtAuthGuard)
  async findPendingHrReview(
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem acessar a fila de triagem.');
    }
    return this.usersService.findPendingHrReview(tenantId);
  }

  // Triagem do RH / Diretoria: Aprova cadastro e ativa o corretor imediatamente
  @Patch(':id/hr-approve')
  @UseGuards(JwtAuthGuard)
  async approveBrokerByHr(
    @Param('id') brokerId: string,
    @Body() body: { carenciaDays?: number },
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.approveBrokerByHr(brokerId, currentUser, tenantId, body?.carenciaDays || 0);
  }

  // Triagem do RH / Diretoria: Ajusta dados/estágio do cadastro antes de aprovar
  @Patch(':id/hr-update')
  @UseGuards(JwtAuthGuard)
  async updateBrokerByHr(
    @Param('id') brokerId: string,
    @Body() dto: { name?: string; nomeGuerra?: string; creci?: string; brokerStage?: 'treinamento' | 'estagiario' | 'corretor_creci'; managerId?: string },
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.updateBrokerByHr(brokerId, dto, currentUser, tenantId);
  }

  // Triagem do RH / Diretoria: Exclusão definitiva para liberar Nome de Guerra e E-mail imediatamente
  @Delete(':id/hard-delete')
  @UseGuards(JwtAuthGuard)
  async hardDeleteBroker(
    @Param('id') brokerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.hardDeleteBroker(brokerId, currentUser, tenantId);
  }

  // 3. Diretoria / RH lista os corretores pendentes de aprovação do tenant
  @Get('pending/:managerId')
  @UseGuards(JwtAuthGuard)
  async findPendingApprovals(
    @Param('managerId') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(currentUser.role)) {
      return this.usersService.findPendingApprovals(null, tenantId);
    }
    // Gerentes não aprovam mais cadastros
    return [];
  }

  // 4. Diretoria / RH aprova o corretor definindo a carência (ROTA PROTEGIDA)
  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approveBroker(
    @Param('id') brokerId: string,
    @Body() approveBrokerDto: ApproveBrokerDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem aprovar Corretores.');
    }
    return this.usersService.approveBroker(brokerId, approveBrokerDto, currentUser, tenantId);
  }

  // 5. Diretoria lista todos os Corretores ativos e em carência do tenant.
  @Get('active-brokers')
  @UseGuards(JwtAuthGuard)
  async listActiveBrokersForDirector(
    @CurrentUser() currentUser: { role: string },
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('managerId') managerId?: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(currentUser.role)) {
      throw new ForbiddenException('Somente a Diretoria e RH podem consultar os Corretores do tenant.');
    }
    return this.usersService.listActiveBrokersForDirector(tenantId, { page: Number(page), pageSize: Number(pageSize), search, status, managerId });
  }

  // Recepção lista os corretores do tenant para efetuar o check-in manual (Plano B)
  @Get('reception-brokers')
  @UseGuards(JwtAuthGuard)
  async listBrokersForReception(
    @CurrentUser('sub') receptionistId: string,
    @TenantId() tenantId: string,
  ) {
    return this.usersService.listBrokersForReception(receptionistId, tenantId);
  }

  // 6. Gerente lista seu time ativo e em carência (ROTA PROTEGIDA) [10]
  @Get('team/:managerId')
  @UseGuards(JwtAuthGuard)
  async findTeam(
    @Param('managerId') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const effectiveManagerId = this.resolveManagerId(managerId, currentUser);
    return this.usersService.findTeam(effectiveManagerId, tenantId, { page: Number(page), pageSize: Number(pageSize), search, status });
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

  @Patch(':id/stage')
  @UseGuards(JwtAuthGuard)
  async updateBrokerStage(
    @Param('id') brokerId: string,
    @Body() dto: UpdateBrokerStageDto,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    return this.usersService.updateBrokerStage(brokerId, dto, currentUser, tenantId);
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

  // Rota para o Gestor de Leads / Gerente consultar a fila de distribuição ao vivo (ROTA PROTEGIDA) [6]
  @Get('leads-queue')
  @UseGuards(JwtAuthGuard)
  async getRealTimeLeadsQueue(
    @TenantId() tenantId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
  ) {
    return this.usersService.getRealTimeLeadsQueue(tenantId, currentUser);
  }

  @Post('seed-clean-hierarchy')
  @UseGuards(JwtAuthGuard)
  async seedCleanHierarchy(
    @TenantId() tenantId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
  ) {
    return this.usersService.seedCleanHierarchy(tenantId, { id: currentUser.sub, role: currentUser.role });
  }

  @Post('clean-for-field-test')
  @UseGuards(JwtAuthGuard)
  async cleanForFieldTest(
    @TenantId() tenantId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
  ) {
    return this.usersService.cleanForFieldTest(tenantId, { id: currentUser.sub, role: currentUser.role });
  }
}