import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { DevService } from './dev.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TestEmailDto, TestPushDto } from './dto/test-tools.dto';

@Controller('dev')
export class DevController {
  constructor(private readonly devService: DevService) {}

  /**
   * Autenticação na suite de Desenvolvedor / SuperAdmin
   */
  @Post('auth')
  async authenticate(@Body('masterKey') masterKey: string) {
    return this.devService.authenticateMasterKey(masterKey);
  }

  /**
   * Telemetria & Monitor de Saúde do Sistema
   */
  @Get('health')
  async getHealth(@Headers('authorization') authHeader?: string) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.getHealthSummary();
  }

  /**
   * Gestão de Tenants: Lista todos os tenants e métricas
   */
  @Get('tenants')
  async getTenants(@Headers('authorization') authHeader?: string) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.getTenants();
  }

  /**
   * Gestão de Tenants: Criação de novo Tenant
   */
  @Post('tenants')
  async createTenant(
    @Body() dto: CreateTenantDto,
    @Headers('authorization') authHeader?: string,
  ) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.createTenant(dto);
  }

  /**
   * Gestão de Tenants: Alteração de status de assinatura
   */
  @Patch('tenants/:id/status')
  async toggleTenantStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Headers('authorization') authHeader?: string,
  ) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.toggleTenantStatus(id, status);
  }

  /**
   * Auditoria: Consulta de Audit Logs em tempo real
   */
  @Get('audit-logs')
  async getAuditLogs(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('tenantId') tenantId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.getAuditLogs({ page, limit, search, tenantId });
  }

  /**
   * Ferramenta DEV: Disparo de E-mail de Teste
   */
  @Post('test-email')
  async testEmail(
    @Body() dto: TestEmailDto,
    @Headers('authorization') authHeader?: string,
  ) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.sendDiagnosticEmail(dto);
  }

  /**
   * Ferramenta DEV: Disparo de Notificação Push de Teste
   */
  @Post('test-push')
  async testPush(
    @Body() dto: TestPushDto,
    @Headers('authorization') authHeader?: string,
  ) {
    this.ensureDevAuthenticated(authHeader);
    return this.devService.sendDiagnosticPush(dto);
  }

  /**
   * Helper de proteção para requisições do Dev Controller
   */
  private ensureDevAuthenticated(authHeader?: string): void {
    if (!this.devService.validateDevToken(authHeader)) {
      throw new UnauthorizedException('Acesso restrito ao SuperAdmin / Desenvolvedor.');
    }
  }
}
