import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between, ILike } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { Presence } from '../presences/entities/presence.entity';
import { DeadManLog } from '../presences/entities/dead-man-log.entity';
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
    @InjectRepository(DeadManLog)
    private readonly deadManLogRepo: Repository<DeadManLog>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
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
   * Painel DEV: Diagnóstico ao vivo — presenças de hoje, corretor on-line, fila por plantão e logs do deadman
   */
  async getLiveOverview(tenantId?: string) {
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const scoped = tenantId ? { tenant_id: tenantId } : {};

    const [tenants, booths, onlinePresences, absentPresences, todayPresences, pendingPings, recentLogs] =
      await Promise.all([
        this.tenantRepo.find({ order: { name: 'ASC' } }),
        this.boothRepo.find({ order: { name: 'ASC' } }),
        this.presenceRepo.find({
          where: { ...scoped, status: 'online' },
          relations: { broker: true, booth: true },
          order: { roleta_position: 'ASC', check_in_at: 'ASC' },
        }),
        this.presenceRepo.find({
          where: { ...scoped, status: 'absent' },
          relations: { broker: true, booth: true },
          order: { check_in_at: 'ASC' },
        }),
        this.presenceRepo.find({
          where: { ...scoped, check_in_at: Between(today0, todayEnd) },
          relations: { booth: true },
        }),
        this.deadManLogRepo.find({
          where: { response_status: 'pending' },
          relations: { presence: { broker: true, booth: true } },
          order: { sent_at: 'DESC' },
          take: 25,
        }),
        this.deadManLogRepo.find({
          relations: { presence: { broker: true, booth: true } },
          order: { sent_at: 'DESC' },
          take: 15,
        }),
      ]);

    const tenantNameById = new Map<string, string>(tenants.map((t) => [t.id, t.name]));

    const statusBreakdown = new Map<string, number>();
    for (const p of todayPresences) {
      statusBreakdown.set(p.status, (statusBreakdown.get(p.status) || 0) + 1);
    }

    const boothsSnapshot = booths
      .filter((b) => !tenantId || b.tenant_id === tenantId)
      .map((b) => {
        const online = onlinePresences.filter((p) => p.booth_id === b.id);
        const absent = absentPresences.filter((p) => p.booth_id === b.id);
        const today = todayPresences.filter((p) => p.booth_id === b.id);
        return {
          boothId: b.id,
          boothName: b.name,
          tenantName: tenantNameById.get(b.tenant_id) || '—',
          lifecycleStatus: b.lifecycle_status,
          onlineCount: online.length,
          awaitingRevalidation: absent.length,
          todayCheckins: today.length,
          onlineBrokers: online.map((p) => ({
            presenceId: p.id,
            brokerId: p.broker_id,
            nomeGuerra: p.broker?.nome_guerra || 'Corretor',
            roletaPosition: p.roleta_position,
            roletaName: p.roleta_name,
            checkInAt: p.check_in_at,
          })),
        };
      });

    return {
      updatedAt: now.toISOString(),
      overall: {
        totalOnline: onlinePresences.length,
        awaitingRevalidation: absentPresences.length,
        pendingPings: pendingPings.length,
        todayCheckins: todayPresences.length,
      },
      statusBreakdownToday: Object.fromEntries(statusBreakdown.entries()),
      booths: boothsSnapshot,
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
        id: p.id,
        status: p.status,
        checkInAt: p.check_in_at,
        checkOutAt: p.check_out_at,
        attendedAt: p.attended_at,
        boothId: p.booth_id,
        boothName: p.booth?.name || '—',
        roletaName: p.roleta_name,
        roletaPosition: p.roleta_position,
        accumulatedMinutes: p.accumulated_minutes,
      })),
    };
  }
}
