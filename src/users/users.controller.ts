// src/users/users.controller.ts
import { Controller, Post, Get, Patch, Body, Param, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { CreateReceptionistDto } from './dto/create-receptionist.dto';
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
      throw new ForbiddenException('Apenas a Diretoria pode criar recepcionistas.');
    }
    return this.usersService.createReceptionist(createReceptionistDto, tenantId);
  }

  // 1. Corretor se cadastra (ROTA PÚBLICA - Sem Guard de segurança) [10]
  @Post('register-broker')
  async registerBroker(@Body() registerBrokerDto: RegisterBrokerDto) {
    return this.usersService.registerBroker(registerBrokerDto);
  }

  // 2. Gerente gera o link de convite (ROTA PROTEGIDA) [10]
  @Post('onboarding-link')
  @UseGuards(JwtAuthGuard)
  async createOnboardingLink(
    @CurrentUser('sub') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    this.resolveManagerId(managerId, currentUser);
    return this.usersService.createOnboardingLink(managerId, tenantId);
  }

  // 3. Gerente lista os corretores pendentes do seu time (ROTA PROTEGIDA) [10]
  @Get('pending/:managerId')
  @UseGuards(JwtAuthGuard)
  async findPendingApprovals(
    @Param('managerId') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    const effectiveManagerId = this.resolveManagerId(managerId, currentUser);
    return this.usersService.findPendingApprovals(effectiveManagerId, tenantId);
  }

  // 4. Gerente aprova o corretor definindo a carência (ROTA PROTEGIDA) [10, 11]
  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approveBroker(
    @Param('id') brokerId: string,
    @Body() approveBrokerDto: ApproveBrokerDto,
    @CurrentUser('sub') managerId: string,
    @CurrentUser() currentUser: { sub: string; role: string },
    @TenantId() tenantId: string,
  ) {
    this.resolveManagerId(managerId, currentUser);
    return this.usersService.approveBroker(brokerId, approveBrokerDto, managerId, tenantId);
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