// src/users/users.controller.ts
import { Controller, Post, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator'; // (Opcional - criaremos na sequência se necessário, ou usamos request.user)

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // 1. Corretor se cadastra (ROTA PÚBLICA - Sem Guard de segurança) [10]
  @Post('register-broker')
  async registerBroker(@Body() registerBrokerDto: RegisterBrokerDto) {
    return this.usersService.registerBroker(registerBrokerDto);
  }

  // 2. Gerente gera o link de convite (ROTA PROTEGIDA) [10]
  @Post('onboarding-link')
  @UseGuards(JwtAuthGuard)
  async createOnboardingLink(@Body() body: any, @TenantId() tenantId: string) {
    // O ID do gerente logado vem decodificado do token JWT (request.user.sub)
    const managerId = body.managerId || body.userId; // Pode vir do token de forma automatizada
    return this.usersService.createOnboardingLink(managerId, tenantId);
  }

  // 3. Gerente lista os corretores pendentes do seu time (ROTA PROTEGIDA) [10]
  @Get('pending/:managerId')
  @UseGuards(JwtAuthGuard)
  async findPendingApprovals(@Param('managerId') managerId: string, @TenantId() tenantId: string) {
    return this.usersService.findPendingApprovals(managerId, tenantId);
  }

  // 4. Gerente aprova o corretor definindo a carência (ROTA PROTEGIDA) [10, 11]
  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approveBroker(
    @Param('id') brokerId: string,
    @Body() approveBrokerDto: ApproveBrokerDto,
    @Body('managerId') managerId: string, // ID do gerente logado enviado no corpo ou token
    @TenantId() tenantId: string,
  ) {
    return this.usersService.approveBroker(brokerId, approveBrokerDto, managerId, tenantId);
  }

  // 5. Gerente lista seu time ativo e em carência (ROTA PROTEGIDA) [10]
  @Get('team/:managerId')
  @UseGuards(JwtAuthGuard)
  async findTeam(@Param('managerId') managerId: string, @TenantId() tenantId: string) {
    return this.usersService.findTeam(managerId, tenantId);
  }

  // ROTA EXCLUSIVA DE TESTES (PÚBLICA): Força o encerramento de carências e ativação imediata [10]
  @Post('test-trigger-carencia')
  async triggerCarenciaManual() {
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