import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between, ILike } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { Presence } from '../presences/entities/presence.entity';
import { DeadManLog } from '../presences/entities/dead-man-log.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { BoothWifi } from '../booths/entities/booth-wifi.entity';
import { PresencesService } from '../presences/presences.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { PushDeviceToken } from '../notifications/entities/push-device-token.entity';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TestEmailDto, TestPushDto } from './dto/test-tools.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

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
    @InjectRepository(DeadManLog)
    private readonly deadManLogRepo: Repository<DeadManLog>,
    @InjectRepository(BoothRuleSet)
    private readonly ruleSetRepo: Repository<BoothRuleSet>,
    @InjectRepository(BoothWifi)
    private readonly wifiRepo: Repository<BoothWifi>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
    private readonly presencesService: PresencesService,
  ) {}

  /**
   * Autenticação de desenvolvedor com Chave Mestra
   */
  async authenticateMasterKey(masterKey: string): Promise<{ success: boolean; token: string }> {
    const validKey =
      process.env.DEV_DASHBOARD_KEY ||
      (process.env.NODE_ENV === 'production' ? '' : 'abiatar-superadmin-master-2026');
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
        features: {
          nova_identidade: typeof t.settings?.features?.nova_identidade === 'boolean' ? t.settings.features.nova_identidade : false,
        },
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
   * Gestão de Tenants: Atualização de configurações (settings) — ex.: features.nova_identidade
   */
  async updateTenantSettings(id: string, dto: UpdateTenantSettingsDto): Promise<Record<string, any>> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado.');

    const beforeFeatures = {
      nova_identidade: typeof tenant.settings?.features?.nova_identidade === 'boolean' ? tenant.settings.features.nova_identidade : false,
    };

    const settings = { ...(tenant.settings || {}) };
    if (dto.features) {
      const features = { ...(settings.features || {}), ...dto.features };
      settings.features = features;
    }
    tenant.settings = settings;
    await this.tenantRepo.save(tenant);

    const afterFeatures = {
      nova_identidade: typeof tenant.settings.features?.nova_identidade === 'boolean' ? tenant.settings.features.nova_identidade : false,
    };

    const log = this.auditRepo.create({
      tenant_id: tenant.id,
      actor_user_id: null,
      actor_role: 'platform_admin_level_0',
      actor_email_snapshot: 'platform_admin@abiatar.bitimob.com.br',
      action: 'superadmin.tenant_settings_updated',
      session_id: 'dev-console',
      entity_type: 'tenant',
      entity_id: tenant.id,
      before_data: { features: beforeFeatures },
      after_data: { features: afterFeatures },
      success: true,
      metadata: { targetSlug: tenant.slug, targetName: tenant.name },
    });
    await this.auditRepo.save(log).catch((err) => this.logger.error(`[DevService] Falha ao gravar audit log: ${err.message}`));

    return {
      success: true,
      message: `Configurações do tenant "${tenant.name}" atualizadas.`,
      features: afterFeatures,
    };
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
   * Envio de Push por Segmento via Firebase FCM
   * - scope 'first5' (padrão) envia apenas para os 5 primeiros dispositivos do filtro;
   * - scope 'all' envia para todos os dispositivos ativos do segmento;
   * - userId filtra um corretor específico; tenantId filtra um tenant.
   */
  async sendDiagnosticPush(dto: TestPushDto): Promise<{ success: boolean; message: string; tokensTargeted: number; sentCount: number }> {
    try {
      const qb = this.pushTokenRepo.createQueryBuilder('pt').where('pt.is_active = true');
      if (dto.tenantId) {
        qb.andWhere('pt.tenant_id = :tid', { tid: dto.tenantId });
      }
      if (dto.userId) {
        qb.andWhere('pt.user_id = :uid', { uid: dto.userId });
      }
      const tokens = await qb.getMany();

      if (tokens.length === 0) {
        return { success: false, message: 'Nenhum token de push registrado para o segmento especificado.', tokensTargeted: 0, sentCount: 0 };
      }

      const scopeLabel = dto.scope === 'all' ? 'todos os dispositivos do segmento' : 'até 5 dispositivos do segmento';
      const targets = dto.scope === 'all' ? tokens : tokens.slice(0, 5);
      const title = dto.title || '🔔 Teste de Notificação DEV';
      const body = dto.body || 'Este é um teste de telemetria disparado pelo Painel SuperAdmin.';

      let sentCount = 0;
      for (const t of targets) {
        const count = await this.notificationsService.sendToUser(t.user_id, t.tenant_id, title, body, { type: 'dev_test' });
        sentCount += count;
      }

      const log = this.auditRepo.create({
        tenant_id: dto.tenantId || null,
        actor_user_id: null,
        actor_role: 'platform_admin_level_0',
        actor_email_snapshot: 'platform_admin@abiatar.bitimob.com.br',
        action: 'superadmin.push_segment_sent',
        session_id: 'dev-console',
        entity_type: 'notification',
        entity_id: null,
        before_data: {},
        after_data: {
          scope: dto.scope || 'first5',
          userId: dto.userId || null,
          title,
          body,
          tokensTargeted: tokens.length,
          sentCount,
        },
        success: true,
        metadata: {},
      });
      await this.auditRepo.save(log).catch((err) => this.logger.error(`[DevService] Falha ao gravar audit log: ${err.message}`));

      return {
        success: true,
        message: `Push disparado para ${scopeLabel}: ${sentCount} dispositivo(s) alcançado(s).`,
        tokensTargeted: tokens.length,
        sentCount,
      };
    } catch (err: any) {
      return { success: false, message: `Erro ao disparar push: ${err.message}`, tokensTargeted: 0, sentCount: 0 };
    }
  }

  /**
   * Painel DEV: Estado do banco — migrations, índices, enums e contadores reais do Postgres
   */
  async getDatabaseStatus() {
    const startTime = Date.now();
    try {
      const [migrations, indexes, enums, tables, columns, databaseSize, exactCounts] = await Promise.all([
        this.dataSource.query(
          `SELECT id, "timestamp" AS applied_at_ms, "name" FROM migrations ORDER BY id`,
        ),
        this.dataSource.query(
          `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('presences','users','booths','tenants','dead_mans_switch_logs') ORDER BY tablename, indexname`,
        ),
        this.dataSource.query(
          `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname IN ('presences_status_enum','dead_mans_switch_logs_response_status_enum','users_role_enum','users_status_enum') ORDER BY t.typname, e.enumsortorder`,
        ),
        this.dataSource.query(
          `SELECT relname AS table_name, n_live_tup AS live_rows, n_dead_tup AS dead_rows FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname`,
        ),
        this.dataSource.query(
          `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('broker_stage','attended_at','attended_by_user_id','begin_at','end_at')`,
        ),
        this.dataSource.query(
          `SELECT pg_size_pretty(pg_database_size(current_database())) AS size_pretty, ROUND(pg_database_size(current_database())::numeric / 1024 / 1024, 1) AS size_mb`,
        ),
        this.dataSource.query(
          `SELECT k AS table_name, n AS row_count FROM (VALUES
            ('tenants',(SELECT COUNT(*) FROM tenants)),
            ('users',(SELECT COUNT(*) FROM users)),
            ('booths',(SELECT COUNT(*) FROM booths)),
            ('presences',(SELECT COUNT(*) FROM presences)),
            ('dead_mans_switch_logs',(SELECT COUNT(*) FROM dead_mans_switch_logs)),
            ('audit_logs',(SELECT COUNT(*) FROM audit_logs)),
            ('messages',(SELECT COUNT(*) FROM messages)),
            ('message_recipients',(SELECT COUNT(*) FROM message_recipients)),
            ('push_device_tokens',(SELECT COUNT(*) FROM push_device_tokens)),
            ('booth_receptionists',(SELECT COUNT(*) FROM booth_receptionists)),
            ('booth_rule_sets',(SELECT COUNT(*) FROM booth_rule_sets)),
            ('booth_holidays',(SELECT COUNT(*) FROM booth_holidays)),
            ('booth_special_schedules',(SELECT COUNT(*) FROM booth_special_schedules)),
            ('manager_onboarding_links',(SELECT COUNT(*) FROM manager_onboarding_links)),
            ('weekly_period_reports',(SELECT COUNT(*) FROM weekly_period_reports)),
            ('weekly_period_report_items',(SELECT COUNT(*) FROM weekly_period_report_items))
          ) AS v(k, n)`,
        ),
      ]);

      const indexByName = new Map<string, string>((indexes as Array<Record<string, any>>).map((i) => [i.indexname, i.indexdef]));
      const enumByType = new Map<string, string[]>();
      for (const e of enums as Array<{ typname: string; enumlabel: string }>) {
        const list = enumByType.get(e.typname) || [];
        list.push(e.enumlabel);
        enumByType.set(e.typname, list);
      }
      const columnPairs = (columns as Array<{ table_name: string; column_name: string }>).map(
        (c) => `${c.table_name}.${c.column_name}`,
      );

      const rowByName = new Map<string, number>(
      (tables as Array<{ table_name: string; live_rows: number }>).map((t) => [t.table_name, t.live_rows]),
    );
    const exactCountsMap = new Map<string, number>(
      (exactCounts as Array<{ table_name: string; row_count: string }>).map((t) => [t.table_name, Number(t.row_count)]),
    );

      return {
        checkedAt: new Date().toISOString(),
        executionDurationMs: Date.now() - startTime,
        databaseSize: databaseSize[0],
        migrations: {
          count: migrations.length,
          last: migrations.length ? migrations[migrations.length - 1] : null,
          applied: migrations,
        },
        tables: tables
          .map((t: any) => ({ table_name: t.table_name, live_rows: t.live_rows, dead_rows: t.dead_rows }))
          .filter((t: any) => !t.table_name.startsWith('pg_')),
        enums: Object.fromEntries(enumByType.entries()),
        indexes,
        checks: {
          uq_presences_broker_active: indexByName.has('uq_presences_broker_active'),
          valid_reception_enum: (enumByType.get('dead_mans_switch_logs_response_status_enum') || []).includes('valid_reception'),
          presences_status_complete: ['online', 'paused', 'absent', 'completed', 'invalidated'].every((s) =>
            (enumByType.get('presences_status_enum') || []).includes(s),
          ),
          users_broker_stage_column: columnPairs.includes('users.broker_stage'),
          presences_attended_columns: columnPairs.includes('presences.attended_at') && columnPairs.includes('presences.attended_by_user_id'),
          rowCounts: {
            tenants: exactCountsMap.get('tenants') ?? 0,
            users: exactCountsMap.get('users') ?? 0,
            booths: exactCountsMap.get('booths') ?? 0,
            presences: exactCountsMap.get('presences') ?? 0,
            dead_mans_switch_logs: exactCountsMap.get('dead_mans_switch_logs') ?? 0,
            audit_logs: exactCountsMap.get('audit_logs') ?? 0,
            messages: exactCountsMap.get('messages') ?? 0,
            push_device_tokens: exactCountsMap.get('push_device_tokens') ?? 0,
            booth_receptionists: exactCountsMap.get('booth_receptionists') ?? 0,
            booth_rule_sets: exactCountsMap.get('booth_rule_sets') ?? 0,
            weekly_period_reports: exactCountsMap.get('weekly_period_reports') ?? 0,
          },
        },
      };
    } catch (err: any) {
      this.logger.error(`[DevService] Falha ao consultar estado do banco: ${err.message}`);
      throw new BadRequestException(`Não foi possível consultar o estado do banco: ${err.message}`);
    }
  }

  /**
   * Painel DEV: Diagnóstico ao vivo — presenças de hoje, corretores on-line, grade de plantões e logs do deadman
   */
  async getLiveOverview(tenantId?: string) {
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const scoped = tenantId ? { tenant_id: tenantId } : {};

    const [tenants, todayPresences, pendingPings, recentLogs, grid] = await Promise.all([
      this.tenantRepo.find({ order: { name: 'ASC' } }),
      this.presenceRepo.find({
        where: { ...scoped, check_in_at: Between(today0, todayEnd) },
        relations: { booth: true },
      }),
      this.deadManLogRepo.find({
        where: { ...scoped, response_status: 'pending' },
        relations: { presence: { broker: true, booth: true } },
        order: { sent_at: 'DESC' },
        take: 50,
      }),
      this.deadManLogRepo.find({
        where: scoped,
        relations: { presence: { broker: true, booth: true } },
        order: { sent_at: 'DESC' },
        take: 15,
      }),
      this.buildBoothGrid(tenantId),
    ]);

    const tenantNameById = new Map<string, string>(tenants.map((t) => [t.id, t.name]));

    const statusBreakdown = new Map<string, number>();
    for (const p of todayPresences) {
      statusBreakdown.set(p.status, (statusBreakdown.get(p.status) || 0) + 1);
    }

    const totalOnline = grid.reduce((sum, g) => sum + g.onlineCount, 0);
    const totalAbsent = grid.reduce((sum, g) => sum + g.awaitingRevalidation, 0);

    return {
      updatedAt: now.toISOString(),
      overall: {
        totalOnline,
        awaitingRevalidation: totalAbsent,
        pendingPings: pendingPings.length,
        todayCheckins: todayPresences.length,
      },
      statusBreakdownToday: Object.fromEntries(statusBreakdown.entries()),
      booths: grid,
      deadmanRecent: recentLogs.map((l) => ({
        id: l.id,
        sentAt: l.sent_at,
        respondedAt: l.responded_at,
        responseStatus: l.response_status,
        brokerId: l.presence?.broker_id || null,
        nomeGuerra: l.presence?.broker?.nome_guerra || '—',
        boothName: l.presence?.booth?.name || '—',
        tenantName: l.presence?.tenant_id ? tenantNameById.get(l.presence.tenant_id) || '—' : '—',
      })),
    };
  }

  /**
   * Painel DEV: Busca de usuários entre todos os tenants
   */
  async searchUsers(params: {
    search?: string;
    tenantId?: string;
    role?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));

    const base: Record<string, unknown> = {};
    if (params.tenantId) base.tenant_id = params.tenantId;
    if (params.role) base.role = params.role;
    if (params.status) base.status = params.status;

    const search = params.search?.trim();
    const where = search
      ? [
          { ...base, name: ILike(`%${search}%`) },
          { ...base, nome_guerra: ILike(`%${search}%`) },
          { ...base, email: ILike(`%${search}%`) },
        ]
      : base;

    const [users, total] = await this.userRepo.findAndCount({
      where,
      relations: { tenant: true },
      order: { created_at: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const todayCountRows: Array<{ broker_id: string; cnt: number }> = users.length
      ? await this.presenceRepo
          .createQueryBuilder('p')
          .select('p.broker_id', 'broker_id')
          .addSelect('COUNT(*)::int', 'cnt')
          .where('p.check_in_at >= :start AND p.check_in_at <= :end', { start: today0, end: todayEnd })
          .andWhere('p.broker_id IN (:...ids)', { ids: users.map((u) => u.id) })
          .groupBy('p.broker_id')
          .getRawMany()
      : [];
    const todayCounts = new Map<string, number>(todayCountRows.map((r) => [r.broker_id, Number(r.cnt)]));

    return {
      total,
      page,
      limit,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        nome_guerra: u.nome_guerra,
        email: u.email,
        role: u.role,
        status: u.status,
        broker_stage: u.broker_stage,
        approved_by_hr: u.approved_by_hr,
        must_change_password: u.must_change_password,
        leads_paused: u.leads_paused,
        last_checkin_at: u.last_checkin_at,
        carencia_ends_at: u.carencia_ends_at,
        stage_expires_at: u.stage_expires_at,
        removed_at: u.removed_at,
        created_at: u.created_at,
        tenantName: u.tenant?.name || '—',
        tenantSlug: u.tenant?.slug || '—',
        presencesToday: todayCounts.get(u.id) || 0,
      })),
    };
  }

  /**
   * Painel DEV: Alteração de status de um usuário (ativo, inativo ou período de graça)
   */
  async setUserStatus(id: string, status: string) {
    const allowed = ['active', 'inactive', 'grace_period'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Status inválido. Use um dos: ${allowed.join(', ')}`);
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não localizado.');
    if (user.role === 'platform_admin_level_0') {
      throw new BadRequestException('Proteção do SuperAdmin: não é possível desativar o acesso de nível zero pelo painel dev.');
    }

    const before = user.status;
    user.status = status;
    await this.userRepo.save(user);

    const log = this.auditRepo.create({
      tenant_id: user.tenant_id,
      actor_user_id: null,
      actor_role: 'platform_admin_level_0',
      actor_email_snapshot: 'platform_admin@abiatar.bitimob.com.br',
      action: 'superadmin.user_status_changed',
      session_id: 'dev-console',
      entity_type: 'user',
      entity_id: user.id,
      before_data: { status: before },
      after_data: { status },
      success: true,
      metadata: { targetEmail: user.email, targetNomeGuerra: user.nome_guerra },
    });
    await this.auditRepo.save(log).catch((err) => this.logger.error(`[DevService] Falha ao gravar audit log: ${err.message}`));

    return {
      success: true,
      message: `Status de '${user.nome_guerra}' alterado para '${status}'.`,
      user: { id: user.id, email: user.email, nome_guerra: user.nome_guerra, status: user.status },
    };
  }

  /**
   * Painel DEV: Exclusão física (hard delete) de qualquer usuário de toda a base.
   *
   * Apaga também todas as referências que não possuem FK com CASCADE no banco:
   *  - corretores/equipe que apontavam para este usuário como gerente (manager_id);
   *  - atribuições de recepção (booth_receptionists);
   *  - atendimentos registrados (presences.attended_by_user_id).
   *
   * As demais referências (presenças, mensagens, convites, push tokens,
   * booths/regras de plantão) já são tratadas pelas FKs existentes
   * (CASCADE/SET NULL).
   */
  async hardDeleteUser(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não localizado.');
    if (user.role === 'platform_admin_level_0') {
      throw new BadRequestException('Proteção do SuperAdmin: não é possível excluir o acesso de nível zero pelo painel dev.');
    }

    const beforeInfo = {
      id: user.id,
      tenant_id: user.tenant_id,
      name: user.name,
      nome_guerra: user.nome_guerra,
      email: user.email,
      role: user.role,
      status: user.status,
      manager_id: user.manager_id,
    };

    const sql = this.dataSource.createQueryRunner();
    try {
      await sql.connect();
      await sql.startTransaction();

      await sql.query(`UPDATE "users" SET "manager_id" = NULL WHERE "manager_id" = $1`, [id]);
      await sql.query(`DELETE FROM "booth_receptionists" WHERE "receptionist_id" = $1`, [id]);
      await sql.query(`UPDATE "presences" SET "attended_by_user_id" = NULL WHERE "attended_by_user_id" = $1`, [id]);

      await sql.query(`DELETE FROM "users" WHERE "id" = $1`, [id]);

      await sql.commitTransaction();
    } catch (err) {
      await sql.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      await sql.release();
    }

    const log = this.auditRepo.create({
      tenant_id: user.tenant_id,
      actor_user_id: null,
      actor_role: 'platform_admin_level_0',
      actor_email_snapshot: 'platform_admin@abiatar.bitimob.com.br',
      action: 'superadmin.user_hard_deleted',
      session_id: 'dev-console',
      entity_type: 'user',
      entity_id: user.id,
      before_data: beforeInfo,
      after_data: { deleted: true },
      success: true,
      metadata: { reason: 'Exclusão física solicitada pelo SuperAdmin no painel dev' },
    });
    await this.auditRepo.save(log).catch((err) => this.logger.error(`[DevService] Falha ao gravar audit log: ${err.message}`));

    return {
      success: true,
      message: `'${user.nome_guerra}' foi excluído definitivamente. Nome de Guerra e e-mail liberados para reutilização.`,
      deletedUserId: user.id,
    };
  }

  /**
   * Painel DEV: Perfil completo de um usuário com histórico de presenças
   */
  async getUserProfile(id: string) {
    const user = await this.userRepo.findOne({ where: { id }, relations: { tenant: true } });
    if (!user) throw new NotFoundException('Usuário não localizado.');

    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [totalPresences, todayPresences, recentPresences, statusRows] = await Promise.all([
      this.presenceRepo.count({ where: { broker_id: id } }),
      this.presenceRepo.find({ where: { broker_id: id, check_in_at: Between(today0, todayEnd) } }),
      this.presenceRepo.find({
        where: { broker_id: id },
        relations: { booth: true },
        order: { check_in_at: 'DESC' },
        take: 20,
      }),
      this.presenceRepo
        .createQueryBuilder('p')
        .select('p.status', 'status')
        .addSelect('COUNT(*)::int', 'cnt')
        .where('p.broker_id = :id', { id })
        .groupBy('p.status')
        .getRawMany(),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusRows as Array<{ status: string; cnt: number }>) {
      byStatus[r.status] = Number(r.cnt);
    }

    return {
      id: user.id,
      name: user.name,
      nome_guerra: user.nome_guerra,
      email: user.email,
      role: user.role,
      status: user.status,
      broker_stage: user.broker_stage,
      creci: user.creci || null,
      approved_by_hr: user.approved_by_hr,
      must_change_password: user.must_change_password,
      leads_paused: user.leads_paused,
      leads_pause_reason: user.leads_pause_reason || null,
      last_checkin_at: user.last_checkin_at,
      carencia_ends_at: user.carencia_ends_at,
      stage_expires_at: user.stage_expires_at,
      created_at: user.created_at,
      updated_at: user.updated_at,
      tenant: user.tenant ? { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug } : null,
      presences: {
        total: totalPresences,
        today: todayPresences.length,
        byStatus,
      },
      recentPresences: recentPresences.map((p) => ({
        boothName: p.booth?.name || '—',
        roletaName: p.roleta_name,
        roletaPosition: p.roleta_position,
        accumulatedMinutes: p.accumulated_minutes,
      })),
    };
  }

  private startOfToday(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
  }

  /**
   * Grade de plantões: regras ativas, Wi-Fi, cobertura, fila da roleta e pings pendentes
   */
  private async buildBoothGrid(tenantId?: string): Promise<Array<Record<string, any>>> {
    const scoped = tenantId ? { tenant_id: tenantId } : {};
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [tenants, ruleSets, wifis, onlinePresences, absentPresences, pendingPings, todayPresences] =
      await Promise.all([
        this.tenantRepo.find(),
        this.ruleSetRepo.find({ where: { is_active: true } }),
        this.wifiRepo.find(),
        this.presenceRepo.find({
          where: { ...scoped, status: 'online' },
          relations: { broker: true },
          order: { roleta_position: 'ASC', check_in_at: 'ASC' },
        }),
        this.presenceRepo.find({
          where: { ...scoped, status: 'absent' },
          relations: { broker: true },
          order: { check_in_at: 'ASC' },
        }),
        this.deadManLogRepo.find({ where: { response_status: 'pending' }, order: { sent_at: 'DESC' } }),
        this.presenceRepo.find({
          where: { ...scoped, check_in_at: Between(this.startOfToday(), todayEnd) },
        }),
      ]);

    const lastCheckinRows = await this.presenceRepo
      .createQueryBuilder('p')
      .select('p.booth_id', 'booth_id')
      .addSelect('MAX(p.check_in_at)', 'last_checkin')
      .groupBy('p.booth_id')
      .getRawMany();

    const tenantNameById = new Map<string, string>(tenants.map((t) => [t.id, t.name]));
    const ruleByBooth = new Map<string, BoothRuleSet>();
    for (const rs of ruleSets) {
      const current = ruleByBooth.get(rs.booth_id);
      if (!current || rs.version > current.version) ruleByBooth.set(rs.booth_id, rs);
    }
    const wifiCount = new Map<string, number>();
    for (const w of wifis) wifiCount.set(w.booth_id, (wifiCount.get(w.booth_id) || 0) + 1);
    const lastCheckin = new Map<string, Date>();
    for (const r of lastCheckinRows as Array<{ booth_id: string; last_checkin: Date }>) lastCheckin.set(r.booth_id, r.last_checkin);

    const presenceBooth = new Map<string, string>();
    for (const p of [...onlinePresences, ...absentPresences]) presenceBooth.set(p.id, p.booth_id);
    const pendingPresenceIds = new Set<string>(pendingPings.map((p) => p.presence_id));
    const pendingByBooth = new Map<string, number>();
    for (const pid of pendingPresenceIds) {
      const boothId = presenceBooth.get(pid);
      if (boothId) pendingByBooth.set(boothId, (pendingByBooth.get(boothId) || 0) + 1);
    }
    const todayByBooth = new Map<string, number>();
    for (const p of todayPresences) todayByBooth.set(p.booth_id, (todayByBooth.get(p.booth_id) || 0) + 1);

    const booths = await this.boothRepo.find({ where: tenantId ? { tenant_id: tenantId } : {}, order: { name: 'ASC' } });

    return booths.map((b) => {
      const rule = ruleByBooth.get(b.id);
      const online = onlinePresences.filter((p) => p.booth_id === b.id);
      const absent = absentPresences.filter((p) => p.booth_id === b.id);
      const minBrokers = rule ? rule.minimum_brokers_required : b.min_brokers_required;

      const roletaGroups = new Map<string, { positions: Array<Record<string, any>>; waitingDraw: number }>();
      for (const p of online) {
        const key = p.roleta_name || 'Sem roleta';
        const group = roletaGroups.get(key) || { positions: [], waitingDraw: 0 };
        const minutesActive = Math.max(0, Math.floor((now.getTime() - new Date(p.validation_starts_at || p.check_in_at).getTime()) / 60000));
        const item = {
          presenceId: p.id,
          brokerId: p.broker_id,
          nomeGuerra: p.broker?.nome_guerra || 'Corretor',
          roletaPosition: p.roleta_position,
          roletaEntryType: p.roleta_entry_type,
          checkInAt: p.check_in_at,
          minutesActive,
          lastConfirmedAt: p.last_confirmed_at,
          nextConfirmationAt: p.next_confirmation_at,
          accumulatedMinutes: p.accumulated_minutes,
          hasPendingPing: pendingPresenceIds.has(p.id),
        };
        if (p.roleta_position != null) {
          group.positions.push(item);
          group.positions.sort((a, b) => (a.roletaPosition ?? 0) - (b.roletaPosition ?? 0));
        } else {
          group.waitingDraw += 1;
        }
        roletaGroups.set(key, group);
      }

      return {
        boothId: b.id,
        boothName: b.name,
        tenantId: b.tenant_id,
        tenantName: tenantNameById.get(b.tenant_id) || '—',
        address: b.address,
        lifecycleStatus: b.lifecycle_status,
        publishedAt: b.published_at,
        wifiCount: wifiCount.get(b.id) || 0,
        minBrokersRequired: minBrokers,
        gpsRadius: rule ? rule.gps_radius_meters : b.gps_radius,
        ruleVersion: rule ? rule.version : null,
        roletaSchedule: rule
          ? {
              roleta1: rule.roleta_1_time,
              roleta2: rule.roleta_2_time,
              roleta3: rule.roleta_3_time,
              weekend: rule.roleta_weekend_time,
              checkinEarlyMinutes: rule.checkin_early_minutes,
              posBarraMinutes: rule.pos_barra_minutes,
              pingIntervalMinutes: rule.ping_interval_minutes,
              pingDeadlineMinutes: rule.ping_response_deadline_minutes,
            }
          : null,
        onlineCount: online.length,
        awaitingRevalidation: absent.length,
        pendingPingCount: pendingByBooth.get(b.id) || 0,
        todayCheckins: todayByBooth.get(b.id) || 0,
        lastCheckInAt: lastCheckin.get(b.id) || null,
        coverageOk: online.length >= minBrokers,
        coverageGap: Math.max(0, minBrokers - online.length),
        currentRoletas: [...roletaGroups.entries()].map(([roletaName, g]) => ({
          roletaName,
          waitingDraw: g.waitingDraw,
          positions: g.positions,
        })),
      };
    });
  }

  /**
   * SuperAdmin: Grade de plantões com regras, cobertura e fila da roleta
   */
  async getBoothsGrid(tenantId?: string) {
    const booths = await this.buildBoothGrid(tenantId);
    return { updatedAt: new Date().toISOString(), booths };
  }

  /**
   * SuperAdmin: Filas & Broker em tempo real — filas da roleta por plantão e pings pendentes
   */
  async getBrokerOverview(tenantId?: string) {
    const now = new Date();
    const [grid, tenants, pending] = await Promise.all([
      this.buildBoothGrid(tenantId),
      this.tenantRepo.find(),
      this.deadManLogRepo.find({
        where: { response_status: 'pending', ...(tenantId ? { tenant_id: tenantId } : {}) },
        relations: { presence: { broker: true, booth: true } },
        order: { sent_at: 'ASC' },
      }),
    ]);
    const tenantNameById = new Map<string, string>(tenants.map((t) => [t.id, t.name]));

    const deadlineRows = await this.dataSource.query(
      `SELECT b.id AS booth_id, COALESCE(
         (SELECT rs.ping_response_deadline_minutes FROM booth_rule_sets rs
          WHERE rs.booth_id = b.id AND rs.is_active = TRUE ORDER BY rs.version DESC LIMIT 1), 5)::int AS deadline_minutes
       FROM booths b`,
    );
    const deadlineByBooth = new Map<string, number>(
      (deadlineRows as Array<{ booth_id: string; deadline_minutes: number }>).map((r) => [r.booth_id, Number(r.deadline_minutes) || 5]),
    );

    const pendingPings = pending.map((p) => {
      const minutesSince = Math.max(0, Math.floor((now.getTime() - new Date(p.sent_at).getTime()) / 60000));
      const deadlineMinutes = p.presence ? deadlineByBooth.get(p.presence.booth_id) || 5 : 5;
      return {
        id: p.id,
        presenceId: p.presence_id,
        brokerId: p.presence?.broker_id || null,
        nomeGuerra: p.presence?.broker?.nome_guerra || '—',
        boothId: p.presence?.booth_id || null,
        boothName: p.presence?.booth?.name || '—',
        tenantName: p.presence?.tenant_id ? tenantNameById.get(p.presence.tenant_id) || '—' : '—',
        sentAt: p.sent_at,
        minutesSince,
        deadlineMinutes,
        overdue: minutesSince >= deadlineMinutes,
      };
    });

    const byBooth = grid.map((g) => ({
      boothId: g.boothId,
      boothName: g.boothName,
      tenantName: g.tenantName,
      lifecycleStatus: g.lifecycleStatus,
      onlineCount: g.onlineCount,
      awaitingRevalidation: g.awaitingRevalidation,
      pendingPingCount: g.pendingPingCount,
      coverageOk: g.coverageOk,
      coverageGap: g.coverageGap,
      waitingDraw: g.currentRoletas.reduce((s: number, r: any) => s + r.waitingDraw, 0),
      inQueue: g.currentRoletas.reduce((s: number, r: any) => s + r.positions.length, 0),
      roletas: g.currentRoletas,
    }));

    return {
      updatedAt: now.toISOString(),
      overall: {
        onlineTotal: grid.reduce((s, g) => s + g.onlineCount, 0),
        awaitingRevalidation: grid.reduce((s, g) => s + g.awaitingRevalidation, 0),
        waitingDraw: byBooth.reduce((s, g) => s + g.waitingDraw, 0),
        inQueue: byBooth.reduce((s, g) => s + g.inQueue, 0),
        pendingPingsTotal: pendingPings.length,
      },
      byBooth,
      pendingPings,
    };
  }

  /**
   * SuperAdmin: Executa manualmente o motor de presenças/pings (processamento da fila)
   */
  async processBrokerQueue() {
    const result = await this.presencesService.processPresencesAndPings();
    const log = this.auditRepo.create({
      tenant_id: null,
      actor_user_id: null,
      actor_role: 'platform_admin_level_0',
      actor_email_snapshot: 'platform_admin@abiatar.bitimob.com.br',
      action: 'superadmin.broker_reprocess',
      session_id: 'dev-console',
      entity_type: 'system',
      entity_id: 'presences-processor',
      before_data: {},
      after_data: { ...result },
      success: true,
      metadata: {},
    });
    await this.auditRepo.save(log).catch((err) => this.logger.error(`[DevService] Falha ao gravar audit log: ${err.message}`));
    return { success: true, ...result };
  }

  /**
   * SuperAdmin: Monitor do Dead Man's Switch — pings pendentes, atrasados e presenças prestes a pingar
   */
  async getDeadmanOverview(tenantId?: string) {
    const now = new Date();
    const scoped = tenantId ? { tenant_id: tenantId } : {};

    const [tenants, pending, online, status24hRows, suspendedTodayRows] = await Promise.all([
      this.tenantRepo.find(),
      this.deadManLogRepo.find({
        where: { ...scoped, response_status: 'pending' },
        relations: { presence: { broker: true, booth: true } },
        order: { sent_at: 'ASC' },
      }),
      this.presenceRepo.find({
        where: { ...scoped, status: 'online' },
        relations: { broker: true, booth: true },
        order: { next_confirmation_at: 'ASC' },
      }),
      this.deadManLogRepo
        .createQueryBuilder('d')
        .select('d.response_status', 'response_status')
        .addSelect('COUNT(*)::int', 'cnt')
        .where('d.sent_at >= :since', { since: new Date(now.getTime() - 24 * 3600 * 1000) })
        .groupBy('d.response_status')
        .getRawMany(),
      this.deadManLogRepo
        .createQueryBuilder('d')
        .select('COUNT(*)::int', 'cnt')
        .where("d.response_status IN ('no_response','outside_area') AND d.responded_at >= :today", { today: this.startOfToday() })
        .getRawOne(),
    ]);
    const tenantNameById = new Map<string, string>(tenants.map((t) => [t.id, t.name]));

    const deadlineRows = await this.dataSource.query(
      `SELECT b.id AS booth_id, COALESCE(
         (SELECT rs.ping_response_deadline_minutes FROM booth_rule_sets rs
          WHERE rs.booth_id = b.id AND rs.is_active = TRUE ORDER BY rs.version DESC LIMIT 1), 5)::int AS deadline_minutes
       FROM booths b`,
    );
    const deadlineByBooth = new Map<string, number>(
      (deadlineRows as Array<{ booth_id: string; deadline_minutes: number }>).map((r) => [r.booth_id, Number(r.deadline_minutes) || 5]),
    );

    const pendingPresenceIds = new Set<string>(pending.map((p) => p.presence_id));
    const aboutToPing = online.filter(
      (p) => !pendingPresenceIds.has(p.id) && p.next_confirmation_at && now.getTime() >= new Date(p.next_confirmation_at).getTime(),
    );

    const pendingPings = pending.map((p) => {
      const minutesSince = Math.max(0, Math.floor((now.getTime() - new Date(p.sent_at).getTime()) / 60000));
      const deadlineMinutes = p.presence ? deadlineByBooth.get(p.presence.booth_id) || 5 : 5;
      return {
        id: p.id,
        presenceId: p.presence_id,
        brokerId: p.presence?.broker_id || null,
        nomeGuerra: p.presence?.broker?.nome_guerra || '—',
        boothId: p.presence?.booth_id || null,
        boothName: p.presence?.booth?.name || '—',
        tenantName: p.presence?.tenant_id ? tenantNameById.get(p.presence.tenant_id) || '—' : '—',
        sentAt: p.sent_at,
        minutesSince,
        deadlineMinutes,
        overdue: minutesSince >= deadlineMinutes,
      };
    });

    const status24h: Record<string, number> = {};
    for (const r of status24hRows as Array<{ response_status: string; cnt: number }>) {
      status24h[r.response_status] = Number(r.cnt);
    }

    return {
      updatedAt: now.toISOString(),
      summary: {
        totalOnline: online.length,
        pending: pending.length,
        overdue: pendingPings.filter((p) => p.overdue).length,
        aboutToPing: aboutToPing.length,
        suspendedToday: Number(suspendedTodayRows?.['cnt'] || 0),
      },
      status24h,
      pendingPings,
      aboutToPing: aboutToPing.map((p) => ({
        presenceId: p.id,
        brokerId: p.broker_id,
        nomeGuerra: p.broker?.nome_guerra || '—',
        boothId: p.booth_id,
        boothName: p.booth?.name || '—',
        tenantName: p.tenant_id ? tenantNameById.get(p.tenant_id) || '—' : '—',
        nextConfirmationAt: p.next_confirmation_at,
        minutesOverdue: Math.max(0, Math.floor((now.getTime() - new Date(p.next_confirmation_at!).getTime()) / 60000)),
      })),
    };
  }

  /**
   * SuperAdmin: Dispara um ping de confirmação manual para uma presença online
   */
  async forceDeadmanPing(presenceId: string) {
    const presence = await this.presenceRepo.findOne({ where: { id: presenceId } });
    if (!presence) throw new NotFoundException('Presença não localizada.');

    const existing = await this.deadManLogRepo.findOne({
      where: { presence_id: presence.id, response_status: 'pending' },
      order: { sent_at: 'DESC' },
    });
    if (existing) {
      throw new BadRequestException('Já existe um ping pendente para esta presença.');
    }

    const log = this.deadManLogRepo.create({
      tenant_id: presence.tenant_id,
      presence_id: presence.id,
      response_status: 'pending',
    });
    await this.deadManLogRepo.save(log);

    void this.notificationsService.sendToUser(
      presence.broker_id,
      presence.tenant_id,
      'Confirme sua presença',
      'Ping de confirmação disparado manualmente pelo SuperAdmin.',
      { type: 'presence_ping', presenceId: presence.id, pingId: log.id },
    );

    const audit = this.auditRepo.create({
      tenant_id: presence.tenant_id,
      actor_user_id: null,
      actor_role: 'platform_admin_level_0',
      actor_email_snapshot: 'platform_admin@abiatar.bitimob.com.br',
      action: 'superadmin.deadman_force_ping',
      session_id: 'dev-console',
      entity_type: 'presence',
      entity_id: presence.id,
      before_data: {},
      after_data: { pingId: log.id, brokerId: presence.broker_id, boothId: presence.booth_id },
      success: true,
      metadata: {},
    });
    await this.auditRepo.save(audit).catch((err) => this.logger.error(`[DevService] Falha ao gravar audit log: ${err.message}`));

    return { success: true, message: 'Ping de confirmação manual disparado com sucesso.', pingId: log.id };
  }

  /**
   * SuperAdmin: Console SQL somente leitura (diagnóstico)
   */
  async runReadOnlySql(sqlInput: string): Promise<Record<string, any>> {
    const raw = String(sqlInput || '').trim();
    if (!raw) throw new BadRequestException('Informe uma consulta SQL para executar.');

    const sql = raw.replace(/;\s*$/, '');
    if (sql.includes(';')) throw new BadRequestException('Envie apenas uma instrução SQL por execução.');

    const head = sql.match(/^\s*(with|select|show|values|explain)\b/i);
    if (!head) throw new BadRequestException('Somente consultas de leitura são permitidas: SELECT, WITH, SHOW, VALUES ou EXPLAIN.');

    if (/(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|analyze|reindex|call|merge|into|pg_sleep)\b/i.test(sql)) {
      throw new BadRequestException('Comando de escrita/execução não permitido no console de leitura.');
    }

    let finalSql = sql;
    if (!/\blimit\s+\d+\b/i.test(finalSql)) finalSql = `${finalSql} LIMIT 500`;

    const started = Date.now();
    try {
      await this.dataSource.query(`BEGIN READ ONLY; SET LOCAL statement_timeout = '5000';`);
      let rows: any[] = [];
      try {
        const result = await this.dataSource.query(finalSql);
        rows = Array.isArray(result) ? result : [];
      } finally {
        await this.dataSource.query('COMMIT');
      }
      const columns = rows.length && typeof rows[0] === 'object' && rows[0] !== null ? Object.keys(rows[0]) : [];
      return {
        success: true,
        durationMs: Date.now() - started,
        rowCount: rows.length,
        truncated: rows.length >= 500,
        columns,
        rows,
      };
    } catch (err: any) {
      throw new BadRequestException(`Erro na consulta: ${err.message}`);
    }
  }

  /**
   * SuperAdmin: Histórico visual — presenças por dia, top corretores e movimentação por plantão
   */
  async getStatsHistory(tenantId?: string, days = 14) {
    const n = Math.min(60, Math.max(3, Number(days) || 14));
    const since = this.startOfToday();
    since.setDate(since.getDate() - (n - 1));

    const scopedParams: string[] = [];
    let tenantClause = '';
    if (tenantId) {
      tenantClause = ` AND p.tenant_id = $${scopedParams.length + 1}`;
      scopedParams.push(tenantId);
    }
    const params = [since.toISOString(), ...scopedParams];

    const perDayRows = await this.dataSource.query(
      `SELECT to_char(date_trunc('day', p.check_in_at), 'YYYY-MM-DD') AS day, p.status AS status, COUNT(*)::int AS cnt
       FROM presences p
       WHERE p.check_in_at >= $1${tenantClause}
       GROUP BY 1, 2
       ORDER BY 1`,
      params,
    );

    const perDayMap = new Map<string, Record<string, number>>();
    for (const r of perDayRows as Array<{ day: string; status: string; cnt: number }>) {
      const bucket = perDayMap.get(r.day) || {};
      bucket[r.status] = Number(r.cnt);
      perDayMap.set(r.day, bucket);
    }
    const perDay: Array<{ date: string; total: number; online: number; completed: number; invalidated: number; absent: number; paused: number }> = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const bucket = perDayMap.get(key) || {};
      perDay.push({
        date: key,
        total: Object.values(bucket).reduce((s, v) => s + Number(v), 0),
        online: Number(bucket['online'] || 0),
        completed: Number(bucket['completed'] || 0),
        invalidated: Number(bucket['invalidated'] || 0),
        absent: Number(bucket['absent'] || 0),
        paused: Number(bucket['paused'] || 0),
      });
    }

    const bp: string[] = [];
    let bpClause = '';
    if (tenantId) {
      bpClause = ' AND p.tenant_id = $1';
      bp.push(tenantId);
    }
    const topBrokers = await this.dataSource.query(
      `SELECT u.nome_guerra, u.email, t.name AS tenant_name, COUNT(p.id)::int AS checkins,
              COALESCE(SUM(p.accumulated_minutes), 0)::int AS minutes_sum
       FROM presences p
       JOIN users u ON u.id = p.broker_id
       JOIN tenants t ON t.id = p.tenant_id
       WHERE p.check_in_at >= CURRENT_DATE${bpClause}
       GROUP BY u.nome_guerra, u.email, t.name
       ORDER BY checkins DESC, minutes_sum DESC
       LIMIT 12`,
      bp,
    );

    const bb: string[] = [];
    let bbClause = '';
    if (tenantId) {
      bbClause = ' AND p.tenant_id = $1';
      bb.push(tenantId);
    }
    const boothRows = await this.dataSource.query(
      `SELECT p.booth_id AS booth_id, b.name AS booth_name, b.lifecycle_status, COUNT(p.id)::int AS checkins
       FROM presences p
       JOIN booths b ON b.id = p.booth_id
       WHERE p.check_in_at >= CURRENT_DATE${bbClause}
       GROUP BY p.booth_id, b.name, b.lifecycle_status
       ORDER BY checkins DESC`,
      bb,
    );

    const todayCompletion: string[] = [];
    let todayClause = '';
    if (tenantId) {
      todayClause = ' AND p.tenant_id = $1';
      todayCompletion.push(tenantId);
    }
    const todayRows = await this.dataSource.query(
      `SELECT p.status AS status, COUNT(*)::int AS cnt
       FROM presences p
       WHERE p.check_in_at >= CURRENT_DATE${todayClause}
       GROUP BY p.status`,
      todayCompletion,
    );
    const todayByStatus: Record<string, number> = {};
    let todayTotal = 0;
    for (const r of todayRows as Array<{ status: string; cnt: number }>) {
      todayByStatus[r.status] = Number(r.cnt);
      todayTotal += Number(r.cnt);
    }

    return {
      updatedAt: new Date().toISOString(),
      days: n,
      perDay,
      today: { total: todayTotal, byStatus: todayByStatus },
      topBrokersToday: topBrokers,
      boothCheckinsToday: boothRows,
    };
  }

  // Manutenção: finaliza em lote todas as presenças online/absent pendentes de um tenant,
  // liberando a fila para novos check-ins (sem apagar registros).
  async finalizeAllStalePresences(tenantId?: string, forceAll: boolean = false) {
    const tenants = tenantId
      ? [tenantId]
      : (await this.tenantRepo.find()).map((t) => t.id);
    const results: Array<{ tenantId: string; finalized: number }> = [];
    let grandTotal = 0;
    for (const tid of tenants) {
      const result = await this.presencesService.finalizeAllStalePresences(tid, forceAll);
      results.push({ tenantId: tid, finalized: result.total });
      grandTotal += result.total;
    }
    return { total: grandTotal, byTenant: results };
  }
}
