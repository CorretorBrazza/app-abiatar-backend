// src/booths/booths.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Booth } from './entities/booth.entity';
import { BoothWifi } from './entities/booth-wifi.entity';
import { BoothReceptionist } from './entities/booth-receptionist.entity';
import { User } from '../users/user.entity';
import { CreateBoothDto } from './dto/create-booth.dto';
import { UpdateBoothDto } from './dto/update-booth.dto';
import { BoothRuleSet } from './entities/booth-rule-set.entity';
import { BoothHoliday } from './entities/booth-holiday.entity';
import { UpdateBoothRulesDto } from './dto/update-booth-rules.dto';
import { CreateBoothHolidayDto } from './dto/create-booth-holiday.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class BoothsService {
  constructor(
    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,

    @InjectRepository(BoothWifi)
    private wifiRepository: Repository<BoothWifi>,

    @InjectRepository(BoothReceptionist)
    private receptionistRepository: Repository<BoothReceptionist>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(BoothRuleSet)
    private ruleSetRepository: Repository<BoothRuleSet>,

    @InjectRepository(BoothHoliday)
    private holidayRepository: Repository<BoothHoliday>,

    private readonly auditService: AuditService,
  ) {}

async onModuleInit() {
  try {
    await this.boothRepository.query(`
      CREATE TABLE IF NOT EXISTS booth_holidays (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        booth_id uuid REFERENCES booths(id) ON DELETE CASCADE,
        date varchar(10) NOT NULL,
        name varchar(150) NOT NULL,
        roleta_time varchar(5) NOT NULL DEFAULT '09:00',
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_booth_holidays_tenant_date ON booth_holidays(tenant_id, date);
    `);
    console.log('[BOOTHS] Schema auto-healing de booth_holidays garantido com sucesso.');
  } catch (err) {
    console.error('[BOOTHS] Aviso ao executar auto-healing de booth_holidays:', err);
  }
}

private normalizeDateString(rawDate: string): string {
  const trimmed = rawDate.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return trimmed;
}

private getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async createHoliday(
  dto: CreateBoothHolidayDto,
  tenantId: string,
  actor: { id: string; role: string; email?: string },
) {
  if (actor.role !== 'diretoria_level_1' && actor.role !== 'platform_admin_level_0') {
    throw new BadRequestException('Apenas a Diretoria pode cadastrar feriados de roleta única.');
  }

  const normalizedDate = this.normalizeDateString(dto.date);
  const today = this.getTodayString();

  if (normalizedDate < today) {
    throw new BadRequestException('Apenas datas de hoje ou posteriores podem ser cadastradas como feriado.');
  }

  const roletaTime = dto.roletaTime || '09:00';
  const createdHolidays: BoothHoliday[] = [];

  if (dto.scope === 'all') {
    const existing = await this.holidayRepository.findOne({
      where: { tenant_id: tenantId, date: normalizedDate, booth_id: IsNull() },
    });
    if (existing) {
      existing.name = dto.name.trim();
      existing.roleta_time = roletaTime;
      const updated = await this.holidayRepository.save(existing);
      createdHolidays.push(updated);
    } else {
      const holiday = this.holidayRepository.create({
        tenant_id: tenantId,
        booth_id: null,
        date: normalizedDate,
        name: dto.name.trim(),
        roleta_time: roletaTime,
        created_by: actor.id,
      });
      const saved = await this.holidayRepository.save(holiday);
      createdHolidays.push(saved);
    }
  } else {
    if (!dto.boothIds || dto.boothIds.length === 0) {
      throw new BadRequestException('Selecione ao menos um plantão para aplicar o feriado.');
    }
    for (const boothId of dto.boothIds) {
      const booth = await this.boothRepository.findOne({ where: { id: boothId, tenant_id: tenantId } });
      if (!booth) continue;

      const existing = await this.holidayRepository.findOne({
        where: { tenant_id: tenantId, date: normalizedDate, booth_id: boothId },
      });
      if (existing) {
        existing.name = dto.name.trim();
        existing.roleta_time = roletaTime;
        const updated = await this.holidayRepository.save(existing);
        createdHolidays.push(updated);
      } else {
        const holiday = this.holidayRepository.create({
          tenant_id: tenantId,
          booth_id: boothId,
          date: normalizedDate,
          name: dto.name.trim(),
          roleta_time: roletaTime,
          created_by: actor.id,
        });
        const saved = await this.holidayRepository.save(holiday);
        createdHolidays.push(saved);
      }
    }
  }

  void this.auditService.record(
    { tenantId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email },
    {
      action: 'HOLIDAY_CREATED',
      entityType: 'BOOTH_HOLIDAY',
      entityId: createdHolidays[0]?.id || 'bulk',
      afterData: { date: normalizedDate, name: dto.name, scope: dto.scope, roletaTime, count: createdHolidays.length },
      reason: `Feriado com Roleta Única cadastrado pela Diretoria: ${dto.name} (${normalizedDate})`,
    },
  );

  return {
    message: 'Feriado com Roleta Única cadastrado com sucesso!',
    holidays: createdHolidays,
  };
}

async listHolidays(tenantId: string) {
  const holidays = await this.holidayRepository.find({
    where: { tenant_id: tenantId },
    relations: { booth: true },
    order: { date: 'ASC', created_at: 'ASC' },
  });

  return holidays.map((h) => ({
    id: h.id,
    date: h.date,
    name: h.name,
    roleta_time: h.roleta_time,
    scope: h.booth_id ? 'specific' : 'all',
    boothId: h.booth_id,
    boothName: h.booth ? h.booth.name : 'Todos os Plantões',
    createdAt: h.created_at,
  }));
}

async deleteHoliday(
  holidayId: string,
  tenantId: string,
  actor: { id: string; role: string; email?: string },
) {
  if (actor.role !== 'diretoria_level_1' && actor.role !== 'platform_admin_level_0') {
    throw new BadRequestException('Apenas a Diretoria pode remover feriados.');
  }

  const holiday = await this.holidayRepository.findOne({
    where: { id: holidayId, tenant_id: tenantId },
    relations: { booth: true },
  });
  if (!holiday) throw new NotFoundException('Feriado não encontrado.');

  const before = { ...holiday };
  await this.holidayRepository.remove(holiday);

  void this.auditService.record(
    { tenantId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email },
    {
      action: 'HOLIDAY_DELETED',
      entityType: 'BOOTH_HOLIDAY',
      entityId: holidayId,
      beforeData: before,
      reason: `Feriado ${before.name} (${before.date}) removido pela Diretoria`,
    },
  );

  return { message: 'Feriado removido com sucesso.' };
}

async isHoliday(boothId: string, tenantId: string, targetDate: Date = new Date()): Promise<{ isHoliday: boolean; name?: string; roletaTime?: string }> {
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const holidays = await this.holidayRepository.find({
    where: { tenant_id: tenantId, date: dateStr },
  });

  const specific = holidays.find((h) => h.booth_id === boothId);
  if (specific) {
    return { isHoliday: true, name: specific.name, roletaTime: specific.roleta_time };
  }

  const global = holidays.find((h) => !h.booth_id);
  if (global) {
    return { isHoliday: true, name: global.name, roletaTime: global.roleta_time };
  }

  return { isHoliday: false };
}

  // 1. Cadastra um novo plantão de vendas com seus respectivos Wi-Fis [7]
  async create(dto: CreateBoothDto, tenantId: string): Promise<Booth> {
    // Cria o registro do Plantão vinculado ao tenant
    const booth = this.boothRepository.create({
      tenant_id: tenantId,
      name: dto.name,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      gps_radius: dto.gps_radius || 100,
      min_brokers_required: dto.min_brokers_required || 2, // [6]
      manager_id: dto.managerId || null, // [7]
      lifecycle_status: 'draft',
      published_at: null,
      published_by: null,
    });

    const savedBooth = await this.boothRepository.save(booth);

    // Se houver Wi-Fis enviados, salva-os vinculados a este plantão [7]
    if (dto.wifis && dto.wifis.length > 0) {
      const wifiEntities = dto.wifis.map((ssid) =>
        this.wifiRepository.create({
          tenant_id: tenantId,
          booth_id: savedBooth.id,
          ssid: ssid,
        }),
      );
      await this.wifiRepository.save(wifiEntities);
    }

    // Retorna o plantão já com as suas redes Wi-Fi associadas [7]
    return this.findOne(savedBooth.id, tenantId);
  }

  // 2. Retorna todos os plantões cadastrados daquela construtora específica [7]
  async findAll(tenantId: string, role?: string): Promise<Booth[]> {
    const booths = await this.boothRepository.find({
      where: { tenant_id: tenantId },
      relations: { wifis: true },
      order: { name: 'ASC' },
    });
    const visibleBooths = role === 'diretoria_level_1' || role === 'platform_admin_level_0'
      ? booths
      : booths.filter((booth) => booth.lifecycle_status === 'published');
    return Promise.all(visibleBooths.map((booth) => this.applyActiveRules(booth)));
  }

  async updateBooth(boothId: string, tenantId: string, actor: { id: string; role: string; email?: string }, dto: UpdateBoothDto): Promise<Booth> {
    if (actor.role !== 'diretoria_level_1' && actor.role !== 'platform_admin_level_0') {
      throw new NotFoundException('Cadastro de plantão não encontrado.');
    }
    const booth = await this.boothRepository.findOne({ where: { id: boothId, tenant_id: tenantId }, relations: { wifis: true } });
    if (!booth) throw new NotFoundException('Plantão de vendas não encontrado.');

    const before = { ...booth };
    booth.name = dto.name ?? booth.name;
    booth.address = dto.address ?? booth.address;
    booth.latitude = dto.latitude ?? booth.latitude;
    booth.longitude = dto.longitude ?? booth.longitude;
    booth.gps_radius = dto.gpsRadius ?? booth.gps_radius;
    booth.min_brokers_required = dto.minimumBrokersRequired ?? booth.min_brokers_required;
    if (dto.managerId !== undefined) booth.manager_id = dto.managerId;
    const saved = await this.boothRepository.save(booth);

    if (dto.wifis !== undefined) {
      await this.wifiRepository.delete({ booth_id: boothId, tenant_id: tenantId });
      if (dto.wifis.length) {
        await this.wifiRepository.save(dto.wifis.map((ssid) => this.wifiRepository.create({ tenant_id: tenantId, booth_id: boothId, ssid: ssid.trim() })));
      }
    }
    await this.auditService.record(
      { tenantId, boothId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email },
      { action: 'BOOTH_UPDATED', entityType: 'booth', entityId: boothId, beforeData: before as unknown as Record<string, unknown>, afterData: saved as unknown as Record<string, unknown>, reason: dto.reason || 'Atualização do cadastro do plantão' },
    );
    return this.findOne(boothId, tenantId);
  }

  async changeLifecycle(boothId: string, tenantId: string, actor: { id: string; role: string; email?: string }, action: 'publish' | 'pause' | 'archive'): Promise<Booth> {
    if (actor.role !== 'diretoria_level_1' && actor.role !== 'platform_admin_level_0') throw new NotFoundException('Plantão não encontrado.');
    const booth = await this.boothRepository.findOne({ where: { id: boothId, tenant_id: tenantId } });
    if (!booth) throw new NotFoundException('Plantão de vendas não encontrado.');
    if (action === 'publish') {
      const rule = await this.ruleSetRepository.findOne({ where: { booth_id: boothId, tenant_id: tenantId, is_active: true }, order: { version: 'DESC' } });
      if (!rule || !rule.created_by) throw new BadRequestException('Configure e salve as regras operacionais antes de publicar este plantão.');
      booth.lifecycle_status = 'published';
      booth.published_at = new Date();
      booth.published_by = actor.id;
    } else if (action === 'pause') {
      booth.lifecycle_status = 'paused';
    } else {
      booth.lifecycle_status = 'archived';
    }
    const saved = await this.boothRepository.save(booth);
    await this.auditService.record(
      { tenantId, boothId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email },
      { action: `BOOTH_${action.toUpperCase()}`, entityType: 'booth', entityId: boothId, afterData: saved as unknown as Record<string, unknown>, reason: `Transição de ciclo de vida: ${action}` },
    );
    return this.findOne(boothId, tenantId);
  }

  // 3. Busca um único plantão por ID, validando se pertence ao tenant solicitante [7]
  async findOne(id: string, tenantId: string): Promise<Booth> {
    const booth = await this.boothRepository.findOne({
      where: { id: id, tenant_id: tenantId },
      relations: { wifis: true },
    });

    if (!booth) {
      throw new NotFoundException('Plantão de vendas não encontrado ou sem autorização de acesso.');
    }

    return this.applyActiveRules(booth);
  }

  private async applyActiveRules(booth: Booth): Promise<Booth> {
    try {
      const baseGpsRadius = Number(booth.gps_radius);
      const baseMinimumBrokers = Number(booth.min_brokers_required);
      const rules = await this.getActiveRuleSet(booth.id, booth.tenant_id);
      booth.base_gps_radius = baseGpsRadius;
      booth.base_min_brokers_required = baseMinimumBrokers;
      booth.effective_gps_radius = Number(rules.gps_radius_meters);
      booth.effective_min_brokers_required = Number(rules.minimum_brokers_required);
      booth.gps_radius = rules.gps_radius_meters;
      booth.min_brokers_required = rules.minimum_brokers_required;
    } catch (error) {
      console.error('[BOOTH_RULES] Falha ao carregar regras; usando valores legados do plantão:', error instanceof Error ? error.message : String(error));
    }
    return booth;
  }

  async getActiveRuleSet(boothId: string, tenantId: string): Promise<BoothRuleSet> {
    const booth = await this.boothRepository.findOne({ where: { id: boothId, tenant_id: tenantId } });
    if (!booth) {
      throw new NotFoundException('Plantão de vendas não encontrado ou sem autorização de acesso.');
    }

    try {
      const ruleSet = await this.ruleSetRepository.findOne({
        where: { booth_id: boothId, tenant_id: tenantId, is_active: true },
        order: { version: 'DESC' },
      });
      if (ruleSet) return ruleSet;

      return this.ruleSetRepository.save(this.ruleSetRepository.create({
        tenant_id: tenantId,
        booth_id: booth.id,
        version: 1,
        minimum_brokers_required: booth.min_brokers_required,
        gps_radius_meters: booth.gps_radius,
      }));
    } catch (error) {
      console.error('[BOOTH_RULES] Tabela de regras indisponível; retornando fallback não persistido:', error instanceof Error ? error.message : String(error));
      return {
        id: '',
        tenant_id: tenantId,
        booth_id: booth.id,
        version: 0,
        is_active: true,
        minimum_brokers_required: booth.min_brokers_required,
        gps_radius_meters: booth.gps_radius,
        minimum_period_minutes: 120,
        period_weight: 1,
        saturday_required_periods: 5,
        sunday_required_periods: 6,
        roleta_1_time: '09:00',
        roleta_2_time: '14:00',
        roleta_3_time: null,
        roleta_weekend_time: '09:00',
        checkin_early_minutes: 30,
        pos_barra_minutes: 30,
        opening_time: '09:00',
        closing_time: '19:00',
        checkin_tolerance_minutes: 0,
        checkout_tolerance_minutes: 0,
        ping_interval_minutes: 30,
        ping_response_deadline_minutes: 5,
        weekend_enabled: true,
        minimum_monthly_periods: 20,
        periods: [],
        created_by: null,
      } as unknown as BoothRuleSet;
    }
  }

  async updateRuleSet(
    boothId: string,
    tenantId: string,
    actor: { id: string; role: string; email?: string },
    dto: UpdateBoothRulesDto,
  ): Promise<BoothRuleSet> {
    if (actor.role !== 'diretoria_level_1') {
      throw new NotFoundException('Configuração de plantão não encontrada.');
    }
    await this.findOne(boothId, tenantId);
    const current = await this.getActiveRuleSet(boothId, tenantId);
    const nextVersion = this.ruleSetRepository.create({
      ...current,
      id: undefined,
      version: current.version + 1,
      is_active: true,
      created_by: actor.id,
      minimum_period_minutes: dto.minimumPeriodMinutes ?? current.minimum_period_minutes,
      period_weight: dto.periodWeight ?? current.period_weight,
      saturday_required_periods: dto.saturdayRequiredPeriods ?? current.saturday_required_periods,
      sunday_required_periods: dto.sundayRequiredPeriods ?? current.sunday_required_periods,
      roleta_1_time: dto.roleta1Time === undefined ? (current.roleta_1_time || '09:00') : dto.roleta1Time,
      roleta_2_time: dto.roleta2Time === undefined ? (current.roleta_2_time || '14:00') : dto.roleta2Time,
      roleta_3_time: dto.roleta3Time === undefined ? current.roleta_3_time : dto.roleta3Time,
      roleta_weekend_time: dto.roletaWeekendTime === undefined ? (current.roleta_weekend_time || '09:00') : dto.roletaWeekendTime,
      checkin_early_minutes: dto.checkinEarlyMinutes ?? (current.checkin_early_minutes ?? 30),
      pos_barra_minutes: dto.posBarraMinutes ?? (current.pos_barra_minutes ?? 30),
      opening_time: dto.openingTime === undefined ? current.opening_time : dto.openingTime,
      closing_time: dto.closingTime === undefined ? current.closing_time : dto.closingTime,
      checkin_tolerance_minutes: dto.checkinToleranceMinutes ?? current.checkin_tolerance_minutes,
      checkout_tolerance_minutes: dto.checkoutToleranceMinutes ?? current.checkout_tolerance_minutes,
      ping_interval_minutes: dto.pingIntervalMinutes ?? current.ping_interval_minutes,
      ping_response_deadline_minutes: dto.pingResponseDeadlineMinutes ?? current.ping_response_deadline_minutes,
      minimum_brokers_required: dto.minimumBrokersRequired ?? current.minimum_brokers_required,
      gps_radius_meters: dto.gpsRadiusMeters ?? current.gps_radius_meters,
      weekend_enabled: dto.weekendEnabled ?? current.weekend_enabled,
      minimum_monthly_periods: dto.minimumMonthlyPeriods ?? current.minimum_monthly_periods,
      periods: dto.periods ?? current.periods ?? [],
    });
    await this.ruleSetRepository.update({ booth_id: boothId, tenant_id: tenantId, is_active: true }, { is_active: false });
    const saved = await this.ruleSetRepository.save(nextVersion);
    await this.auditService.record(
      { tenantId, boothId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email },
      {
        action: 'BOOTH_RULES_UPDATED',
        entityType: 'booth_rule_set',
        entityId: saved.id,
        beforeData: current as unknown as Record<string, unknown>,
        afterData: saved as unknown as Record<string, unknown>,
        reason: dto.reason || 'Atualização das regras do plantão pela Diretoria',
      },
    );
    return saved;
  }

  async assignReceptionist(
    boothId: string,
    receptionistId: string,
    tenantId: string,
  ): Promise<BoothReceptionist> {
    await this.findOne(boothId, tenantId);
    const receptionist = await this.userRepository.findOne({
      where: { id: receptionistId, tenant_id: tenantId, role: 'recepcao_level_3', status: 'active', removed_at: IsNull() },
    });
    if (!receptionist) {
      throw new NotFoundException('Recepção não encontrada neste tenant.');
    }

    const existing = await this.receptionistRepository.findOne({
      where: { booth_id: boothId, receptionist_id: receptionistId },
    });
    if (existing) {
      existing.is_active = true;
      return this.receptionistRepository.save(existing);
    }

    return this.receptionistRepository.save(this.receptionistRepository.create({
      tenant_id: tenantId,
      booth_id: boothId,
      receptionist_id: receptionistId,
      is_active: true,
    }));
  }

  async listAssignedToReceptionist(receptionistId: string, tenantId: string) {
    const receptionist = await this.userRepository.findOne({ where: { id: receptionistId, tenant_id: tenantId, role: 'recepcao_level_3', status: 'active', removed_at: IsNull() } });
    if (!receptionist) return [];
    const assignments = await this.receptionistRepository.find({
      where: { receptionist_id: receptionistId, tenant_id: tenantId, is_active: true },
    });
    if (assignments.length === 0) return [];

    const booths = await this.boothRepository.find({
      where: assignments.map((assignment) => ({
        id: assignment.booth_id,
        tenant_id: tenantId,
      })),
      relations: { wifis: true },
      order: { name: 'ASC' },
    });
    return booths
      .filter((booth) => booth.lifecycle_status === 'published')
      .map((booth) => ({
        ...booth,
        reception_assignment_id: assignments.find((assignment) => assignment.booth_id === booth.id)?.id,
      }));
  }

  async listReceptionists(boothId: string, tenantId: string) {
    await this.findOne(boothId, tenantId);
    const assignments = await this.receptionistRepository.find({
      where: { booth_id: boothId, tenant_id: tenantId, is_active: true },
      order: { created_at: 'ASC' },
    });
    const users = await this.userRepository.find({
      where: { tenant_id: tenantId, role: 'recepcao_level_3', status: 'active', removed_at: IsNull() },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return assignments.map((assignment) => ({
      ...assignment,
      receptionist: byId.get(assignment.receptionist_id)
        ? {
            id: byId.get(assignment.receptionist_id)!.id,
            name: byId.get(assignment.receptionist_id)!.name,
            email: byId.get(assignment.receptionist_id)!.email,
          }
        : null,
    }));
  }

  async removeReceptionist(
    boothId: string,
    receptionistId: string,
    tenantId: string,
  ): Promise<{ removed: boolean }> {
    await this.findOne(boothId, tenantId);
    const assignment = await this.receptionistRepository.findOne({
      where: { booth_id: boothId, receptionist_id: receptionistId, tenant_id: tenantId },
    });
    if (!assignment) return { removed: false };
    assignment.is_active = false;
    await this.receptionistRepository.save(assignment);
    return { removed: true };
  }

  // 4. Remove um plantão de vendas (as redes Wi-Fi associadas caem em cascata no banco) [7]
  async remove(id: string, tenantId: string): Promise<{ message: string }> {
    const booth = await this.findOne(id, tenantId);
    await this.boothRepository.remove(booth);
    return { message: 'Plantão de vendas e redes Wi-Fi removidos com sucesso.' };
  }
}