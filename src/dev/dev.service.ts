import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { Presence } from '../presences/entities/presence.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { PushDeviceToken } from '../notifications/entities/push-device-token.entity';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TestEmailDto, TestPushDto } from './dto/test-tools.dto';

@Injectable()
export class DevService {
  private readonly logger = new Logger(DevService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Booth)
    private readonly boothRepo: Repository<Booth>,
    @InjectRepository(Presence)
    private readonly presenceRepo: Repository<Presence>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(PushDeviceToken)
    private readonly pushTokenRepo: Repository<PushDeviceToken>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /**
   * Autenticação de desenvolvedor com Chave Mestra
   */
  async authenticateMasterKey(masterKey: string): Promise<{ success: boolean; token: string }> {
    const validKey = process.env.DEV_DASHBOARD_KEY || 'abiatar-superadmin-master-2026';
    if (!masterKey || masterKey.trim() !== validKey.trim()) {
      throw new UnauthorizedException('Chave mestra de desenvolvedor inválida.');
    }
    const payload = JSON.stringify({
      role: 'platform_admin_level_0',
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    const token = Buffer.from(payload).toString('base64');
    return { success: true, token };
  }

  /**
   * Validação de token de desenvolvedor
   */
  validateDevToken(tokenHeader?: string): boolean {
    if (!tokenHeader) return false;
    const token = tokenHeader.replace(/^Bearer\s+/i, '');
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
      if (decoded.role !== 'platform_admin_level_0') return false;
      if (new Date(decoded.expiresAt) < new Date()) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Telemetria & Monitor de Saúde do Sistema
   */
  async getHealthSummary(): Promise<Record<string, any>> {
    const startTime = Date.now();
    let dbStatus = 'healthy';
    let dbLatencyMs = 0;

    try {
      const dbStart = Date.now();
      await this.dataSource.query('SELECT 1');
      dbLatencyMs = Date.now() - dbStart;
    } catch (err: any) {
      dbStatus = `unhealthy: ${err.message}`;
    }

    // Contadores globais
    const [
      totalTenants,
      totalUsers,
      totalBooths,
      totalPresencesToday,
      totalAuditLogs,
      totalPushTokens,
    ] = await Promise.all([
      this.tenantRepo.count().catch(() => 0),
      this.userRepo.count().catch(() => 0),
      this.boothRepo.count().catch(() => 0),
      this.presenceRepo
        .createQueryBuilder('p')
        .where('p.data_presenca = CURRENT_DATE')
        .getCount()
        .catch(() => 0),
      this.auditRepo.count().catch(() => 0),
      this.pushTokenRepo.count().catch(() => 0),
    ]);

    // Breakdown de usuários por papel
    const usersByRole = await this.userRepo
      .createQueryBuilder('u')
      .select('u.role', 'role')
      .addSelect('COUNT(u.id)', 'count')
      .groupBy('u.role')
      .getRawMany()
      .catch(() => []);

    // Memória e processo do Node
    const mem = process.memoryUsage();
    const memFormatted = {
      rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
    };

    const uptimeSeconds = Math.round(process.uptime());
    const uptimeFormatted = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;

    // Status de Integrações
    const resendKeyConfigured = !!process.env.RESEND_API_KEY;
    const resendDomain = process.env.MAIL_FROM || 'onboarding@abiatar.bitimob.com.br';
    const fcmConfigured = !!process.env.FIREBASE_SERVICE_ACCOUNT || !!process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

    return {
      status: dbStatus === 'healthy' ? 'ONLINE' : 'DEGRADED',
      checkedAt: new Date().toISOString(),
      executionDurationMs: Date.now() - startTime,
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        provider: 'PostgreSQL',
      },
      system: {
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production',
        uptime: uptimeFormatted,
        uptimeSeconds,
        memory: memFormatted,
      },
      counts: {
        tenants: totalTenants,
        users: totalUsers,
        booths: totalBooths,
        presencesToday: totalPresencesToday,
        auditLogs: totalAuditLogs,
        pushTokens: totalPushTokens,
      },
      usersByRole,
      integrations: {
        resend: {
          configured: resendKeyConfigured,
          fromDomain: resendDomain,
          status: resendKeyConfigured ? 'CONNECTED' : 'NOT_CONFIGURED',
        },
        firebase: {
          configured: fcmConfigured,
          registeredTokens: totalPushTokens,
          status: fcmConfigured ? 'CONNECTED' : 'NOT_CONFIGURED',
        },
      },
    };
  }

  /**
   * Lista todos os Tenants com estatísticas
   */
  async getTenants(): Promise<Array<Record<string, any>>> {
    const tenants = await this.tenantRepo.find({
      order: { created_at: 'ASC' },
    });

    const result: Array<Record<string, any>> = [];
    for (const t of tenants) {
      const [totalUsers, totalBrokers, totalManagers, totalBooths, presencesToday] = await Promise.all([
        this.userRepo.count({ where: { tenant_id: t.id } }).catch(() => 0),
        this.userRepo.count({ where: { tenant_id: t.id, role: 'corretor_level_3' } }).catch(() => 0),
        this.userRepo.count({ where: { tenant_id: t.id, role: 'gerencia_level_2' } }).catch(() => 0),
        this.boothRepo.count({ where: { tenant_id: t.id } }).catch(() => 0),
        this.presenceRepo
          .createQueryBuilder('p')
          .where('p.tenant_id = :tid', { tid: t.id })
          .andWhere('p.data_presenca = CURRENT_DATE')
          .getCount()
          .catch(() => 0),
      ]);

      result.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        primary_color: t.primary_color,
        secondary_color: t.secondary_color,
        logo_url: t.logo_url,
        status_assinatura: t.status_assinatura,
        limite_plantoes: t.limite_plantoes,
        limite_corretores: t.limite_corretores,
        data_vencimento: t.data_vencimento,
        created_at: t.created_at,
        stats: {
          totalUsers,
          totalBrokers,
          totalManagers,
          totalBooths,
          presencesToday,
        },
      });
    }

    return result;
  }

  /**
   * Criação rápida de um novo Tenant com Administrador Master
   */
  async createTenant(dto: CreateTenantDto): Promise<Record<string, any>> {
    const existingSlug = await this.tenantRepo.findOne({ where: { slug: dto.slug.toLowerCase().trim() } });
    if (existingSlug) {
      throw new BadRequestException(`O subdomínio/slug "${dto.slug}" já está em uso por outro tenant.`);
    }

    const existingEmail = await this.userRepo.findOne({ where: { email: dto.adminEmail.toLowerCase().trim() } });
    if (existingEmail) {
      throw new BadRequestException(`O e-mail "${dto.adminEmail}" já está cadastrado no sistema.`);
    }

    const newTenant = new Tenant();
    newTenant.name = dto.name.trim();
    newTenant.slug = dto.slug.toLowerCase().trim();
    newTenant.primary_color = dto.primaryColor?.trim() || '#E31C1C';
    newTenant.secondary_color = dto.secondaryColor?.trim() || '#000000';
    if (dto.logoUrl?.trim()) {
      newTenant.logo_url = dto.logoUrl.trim();
    }
    newTenant.status_assinatura = 'active';
    newTenant.limite_plantoes = 10;
    newTenant.limite_corretores = 300;

    const savedTenant = await this.tenantRepo.save(newTenant);

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.adminPassword, saltRounds);

    const newAdmin = new User();
    newAdmin.tenant_id = savedTenant.id;
    newAdmin.name = dto.adminName.trim();
    newAdmin.nome_guerra = dto.adminNomeGuerra.trim().toLocaleUpperCase('pt-BR');
    newAdmin.email = dto.adminEmail.toLowerCase().trim();
    newAdmin.password_hash = passwordHash;
    newAdmin.role = 'diretoria_level_1';
    newAdmin.status = 'active';
    newAdmin.broker_stage = null;
    newAdmin.must_change_password = false;
    newAdmin.approved_by_hr = true;

    const savedAdmin = await this.userRepo.save(newAdmin);

    this.logger.log(`[DevService] Novo Tenant "${savedTenant.name}" (${savedTenant.slug}) criado com sucesso por SuperAdmin. Admin: ${savedAdmin.email}`);

    return {
      success: true,
      message: `Tenant "${savedTenant.name}" criado com sucesso!`,
      tenant: savedTenant,
      admin: {
        id: savedAdmin.id,
        name: savedAdmin.name,
        nome_guerra: savedAdmin.nome_guerra,
        email: savedAdmin.email,
        role: savedAdmin.role,
      },
    };
  }

  /**
   * Alterar status de assinatura do Tenant
   */
  async toggleTenantStatus(id: string, status: string): Promise<Record<string, any>> {
    const validStatuses = ['active', 'inactive', 'suspended', 'trial'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Status inválido. Escolha entre: ${validStatuses.join(', ')}`);
    }

    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado.');

    tenant.status_assinatura = status;
    await this.tenantRepo.save(tenant);

    return { success: true, message: `Status do tenant "${tenant.name}" alterado para "${status}".`, tenant };
  }

  /**
   * Consulta paginada de Audit Logs
   */
  async getAuditLogs(params: {
    page?: number;
    limit?: number;
    search?: string;
    tenantId?: string;
  }): Promise<{ logs: AuditLog[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    const skip = (page - 1) * limit;

    const qb = this.auditRepo.createQueryBuilder('a').orderBy('a.created_at', 'DESC').skip(skip).take(limit);

    if (params.tenantId) {
      qb.andWhere('a.tenant_id = :tenantId', { tenantId: params.tenantId });
    }

    if (params.search) {
      qb.andWhere(
        '(a.action ILIKE :search OR a.actor_email_snapshot ILIKE :search OR a.entity_type ILIKE :search)',
        { search: `%${params.search}%` },
      );
    }

    const [logs, total] = await qb.getManyAndCount();
    return { logs, total, page, limit };
  }

  /**
   * Envio de E-mail de Teste Diagnóstico via Resend
   */
  async sendDiagnosticEmail(dto: TestEmailDto): Promise<{ success: boolean; message: string }> {
    try {
      const sent = await this.emailService.sendBrokerRegistrationToHr({
        brokerName: 'Teste de Diagnóstico DEV',
        brokerNomeGuerra: 'DIAGNÓSTICO',
        brokerEmail: dto.targetEmail,
        brokerStage: 'corretor_creci',
        creci: 'TESTE-DEV',
        managerName: 'Sistema SuperAdmin',
        managerNomeGuerra: 'SUPERADMIN',
        tenantName: 'ABIATAR DEV SUITE',
        documents: [],
      });

      if (sent) {
        return { success: true, message: `E-mail de diagnóstico enviado com sucesso para ${dto.targetEmail} via Resend.` };
      } else {
        return { success: false, message: 'Falha no envio via Resend. Verifique as credenciais e o log do servidor.' };
      }
    } catch (err: any) {
      return { success: false, message: `Erro ao enviar e-mail: ${err.message}` };
    }
  }

  /**
   * Envio de Push de Teste Diagnóstico via Firebase FCM
   */
  async sendDiagnosticPush(dto: TestPushDto): Promise<{ success: boolean; message: string; tokensTargeted: number }> {
    try {
      const qb = this.pushTokenRepo.createQueryBuilder('pt').where('pt.is_active = true');
      if (dto.tenantId) {
        qb.andWhere('pt.tenant_id = :tid', { tid: dto.tenantId });
      }
      const tokens = await qb.getMany();

      if (tokens.length === 0) {
        return { success: false, message: 'Nenhum token de push registrado para o filtro especificado.', tokensTargeted: 0 };
      }

      let sentCount = 0;
      const title = dto.title || '🔔 Teste de Notificação DEV';
      const body = dto.body || 'Este é um teste de telemetria disparado pelo Painel SuperAdmin.';

      // Envia para os primeiros 5 dispositivos encontrados para validação
      for (const t of tokens.slice(0, 5)) {
        const count = await this.notificationsService.sendToUser(t.user_id, t.tenant_id, title, body, { type: 'dev_test' });
        sentCount += count;
      }

      return {
        success: true,
        message: `Notificação enviada com sucesso para ${sentCount} dispositivo(s).`,
        tokensTargeted: tokens.length,
      };
    } catch (err: any) {
      return { success: false, message: `Erro ao disparar push: ${err.message}`, tokensTargeted: 0 };
    }
  }
}
