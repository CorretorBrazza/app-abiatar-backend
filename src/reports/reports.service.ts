import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Presence } from '../presences/entities/presence.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { WeeklyPeriodReport } from './entities/weekly-period-report.entity';
import { WeeklyPeriodReportItem } from './entities/weekly-period-report-item.entity';
import { AuditService } from '../audit/audit.service';

interface Actor { sub: string; role: string; }

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(WeeklyPeriodReport) private readonly reportRepository: Repository<WeeklyPeriodReport>,
    @InjectRepository(WeeklyPeriodReportItem) private readonly itemRepository: Repository<WeeklyPeriodReportItem>,
    @InjectRepository(Presence) private readonly presenceRepository: Repository<Presence>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Booth) private readonly boothRepository: Repository<Booth>,
    @InjectRepository(BoothRuleSet) private readonly ruleRepository: Repository<BoothRuleSet>,
    @InjectRepository(BoothReceptionist) private readonly receptionistRepository: Repository<BoothReceptionist>,
    private readonly auditService: AuditService,
  ) {}

  private getWeekRange(input?: string) {
    const base = input ? new Date(`${input}T00:00:00`) : new Date();
    if (Number.isNaN(base.getTime())) throw new NotFoundException('Semana inválida.');
    const day = base.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(base);
    start.setDate(base.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end, startKey: start.toISOString().slice(0, 10), endKey: end.toISOString().slice(0, 10) };
  }

  private async allowedScope(actor: Actor, tenantId: string) {
    if (actor.role === 'diretoria_level_1' || actor.role === 'platform_admin_level_0') return { brokerIds: null as string[] | null, boothIds: null as string[] | null };
    if (actor.role === 'gerencia_level_2') {
      const brokers = await this.userRepository.find({ where: { tenant_id: tenantId, manager_id: actor.sub, role: 'corretor_level_3' } });
      return { brokerIds: brokers.map((user) => user.id), boothIds: null as string[] | null };
    }
    if (actor.role === 'recepcao_level_3') {
      const assignments = await this.receptionistRepository.find({ where: { receptionist_id: actor.sub, tenant_id: tenantId } });
      return { brokerIds: null as string[] | null, boothIds: assignments.map((item) => item.booth_id) };
    }
    if (actor.role === 'corretor_level_3') return { brokerIds: [actor.sub], boothIds: null as string[] | null };
    throw new ForbiddenException('Perfil sem acesso ao relatório semanal.');
  }

  async getWeeklyReport(tenantId: string, actor: Actor, weekStart?: string) {
    const range = this.getWeekRange(weekStart);
    const scope = await this.allowedScope(actor, tenantId);
    let report = await this.reportRepository.findOne({ where: { tenant_id: tenantId, week_start: range.startKey } });
    if (!report) {
      report = await this.reportRepository.save(this.reportRepository.create({
        tenant_id: tenantId,
        week_start: range.startKey,
        week_end: range.endKey,
        status: 'in_progress',
        rules_snapshot: {},
        totals: {},
        closed_at: null,
        closed_by: null,
      }));
    }

    if (report.status === 'in_progress') await this.rebuildCurrentReport(report, tenantId, range.start, range.end);
    const items = await this.itemRepository.find({ where: { report_id: report.id }, order: { broker_name_snapshot: 'ASC' } });
    const filtered = items.filter((item) => {
      const brokerOk = !scope.brokerIds || scope.brokerIds.includes(item.broker_id);
      const boothOk = !scope.boothIds || scope.boothIds.includes(item.booth_id);
      return brokerOk && boothOk;
    });
    return { report, items: filtered, scope: actor.role };
  }

  async closeWeeklyReport(tenantId: string, actor: Actor, weekStart?: string) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(actor.role)) throw new ForbiddenException('Somente a Diretoria pode fechar relatórios semanais.');
    const range = this.getWeekRange(weekStart);
    const report = await this.reportRepository.findOne({ where: { tenant_id: tenantId, week_start: range.startKey } });
    if (!report) throw new NotFoundException('Relatório semanal não encontrado.');
    if (report.status !== 'closed') {
      const before = { status: report.status, totals: report.totals };
      report.status = 'closed';
      report.closed_at = new Date();
      report.closed_by = actor.sub;
      await this.reportRepository.save(report);
      void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, { action: 'WEEKLY_PERIOD_REPORT_CLOSED', entityType: 'WEEKLY_PERIOD_REPORT', entityId: report.id, beforeData: before, afterData: { status: report.status, totals: report.totals }, reason: 'Fechamento semanal' });
    }
    return this.getWeeklyReport(tenantId, actor, range.startKey);
  }

  private async rebuildCurrentReport(report: WeeklyPeriodReport, tenantId: string, start: Date, end: Date) {
    const presences = await this.presenceRepository.find({ where: { tenant_id: tenantId, check_in_at: Between(start, end) } });
    const brokerIds = [...new Set(presences.map((presence) => presence.broker_id))];
    const boothIds = [...new Set(presences.map((presence) => presence.booth_id))];
    const users = brokerIds.length ? await this.userRepository.find({ where: { tenant_id: tenantId, id: In(brokerIds) } }) : [];
    const booths = boothIds.length ? await this.boothRepository.find({ where: { tenant_id: tenantId, id: In(boothIds) } }) : [];
    const rules = boothIds.length ? await this.ruleRepository.find({ where: { tenant_id: tenantId, booth_id: In(boothIds), is_active: true } }) : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    const boothMap = new Map(booths.map((booth) => [booth.id, booth]));
    const grouped = new Map<string, Presence[]>();
    for (const presence of presences) {
      const key = `${presence.broker_id}:${presence.booth_id}`;
      grouped.set(key, [...(grouped.get(key) || []), presence]);
    }
    await this.itemRepository.delete({ report_id: report.id });
    const items = [...grouped.entries()].map(([key, records]) => {
      const [brokerId, boothId] = key.split(':');
      const user = userMap.get(brokerId);
      const valid = records.filter((record) => record.status === 'completed' && Number(record.accumulated_minutes || 0) >= Number(record.minimum_period_minutes || 120));
      const invalidated = records.filter((record) => record.status === 'invalidated' || record.status === 'absent');
      const minutes = records.reduce((sum, record) => sum + Number(record.accumulated_minutes || 0), 0);
      const weighted = valid.reduce((sum, record) => sum + Number(record.period_weight || 1), 0);
      const rule = rules.find((candidate) => candidate.booth_id === boothId);
      return this.itemRepository.create({
        report_id: report.id,
        tenant_id: tenantId,
        broker_id: brokerId,
        manager_id: user?.manager_id || null,
        booth_id: boothId,
        broker_name_snapshot: user?.name || 'Corretor removido',
        broker_nome_guerra_snapshot: user?.nome_guerra || null,
        valid_periods: valid.length,
        invalidated_periods: invalidated.length,
        accumulated_minutes: minutes,
        weighted_periods: weighted,
        presence_count: records.length,
        absence_count: invalidated.length,
        weekend_eligible: Boolean(rule?.weekend_enabled && weighted >= Math.max(rule?.saturday_required_periods || 5, rule?.sunday_required_periods || 6)),
        details: { boothName: boothMap.get(boothId)?.name || 'Plantão', statuses: records.map((record) => record.status) },
      });
    });
    if (items.length) await this.itemRepository.save(items);
    report.rules_snapshot = Object.fromEntries(rules.map((rule) => [rule.booth_id, { version: rule.version, minimum_period_minutes: rule.minimum_period_minutes, period_weight: rule.period_weight, saturday_required_periods: rule.saturday_required_periods, sunday_required_periods: rule.sunday_required_periods, weekend_enabled: rule.weekend_enabled }]));
    report.totals = { items: items.length, validPeriods: items.reduce((sum, item) => sum + item.valid_periods, 0), invalidatedPeriods: items.reduce((sum, item) => sum + item.invalidated_periods, 0), accumulatedMinutes: items.reduce((sum, item) => sum + item.accumulated_minutes, 0) };
    await this.reportRepository.save(report);
  }
}
