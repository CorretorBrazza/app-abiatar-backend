import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Between, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule'; // Importa o decorador de tarefas agendadas

import { Presence } from './entities/presence.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { ALL_BROKER_STAGES } from '../booths/dto/update-booth-rules.dto';
import { BoothHoliday } from '../booths/entities/booth-holiday.entity';
import { BoothSpecialSchedule } from '../booths/entities/booth-special-schedule.entity';
import { DeadManLog } from './entities/dead-man-log.entity';
import { CheckInDto } from './dto/check-in.dto';
import { PingResponseDto } from './dto/ping-response.dto';
import { Message } from '../messages/entities/message.entity';
import { MessageRecipient } from '../messages/entities/message-recipient.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { getNowInTimezone, timeStringToMinutes, minutesToTimeString, TimezoneNow, getDateAtTimeInTimezone } from '../utils/timezone.util';

@Injectable()
export class PresencesService {
  constructor(
    @InjectRepository(Presence)
    private presenceRepository: Repository<Presence>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,

    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,

    @InjectRepository(BoothRuleSet)
    private ruleSetRepository: Repository<BoothRuleSet>,

    @InjectRepository(BoothHoliday)
    private holidayRepository: Repository<BoothHoliday>,

    @InjectRepository(BoothSpecialSchedule)
    private specialScheduleRepository: Repository<BoothSpecialSchedule>,

    @InjectRepository(BoothReceptionist)
    private receptionistRepository: Repository<BoothReceptionist>,

    @InjectRepository(DeadManLog)
    private logRepository: Repository<DeadManLog>,

    @InjectRepository(AttendanceRecord)
    private attendanceRepository: Repository<AttendanceRecord>,

    @InjectRepository(Message)
    private messageRepository: Repository<Message>,

    @InjectRepository(MessageRecipient)
    private recipientRepository: Repository<MessageRecipient>,
    private notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /** Retorna os minutos efetivos de uma presença, incluindo o tempo em andamento para sessões 'online'. */
  private getEffectiveMinutes(p: Presence, now: Date = new Date()): number {
    if (p.status === 'online') {
      const start = p.validation_starts_at || p.check_in_at;
      return Math.max(0, Math.floor((now.getTime() - new Date(start).getTime()) / 1000 / 60));
    }
    return p.accumulated_minutes || 0;
  }

  /* Estabelece se o tenant usa a "nova identidade" (features.nova_identidade = true).
     O fluxo novo de atendimento (simples/vez, fora da janela, registro de atendimentos)
     só vale para esses tenants; os demais continuam com o comportamento legado. */
  private async isNovaIdentidade(tenantId: string): Promise<boolean> {
    try {
      const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
      const features = tenant?.settings?.features as { nova_identidade?: boolean } | undefined;
      return features?.nova_identidade === true;
    } catch {
      return false;
    }
  }

  /* Status final de um período. Presenças fora da janela registram presença/atendimento,
     mas NUNCA são validadas como período (regra: registrar, não validar). */
  private resolveFinalStatus(presence: Presence, elapsedMinutes: number): 'completed' | 'invalidated' {
    if ((presence.roleta_entry_type as string) === 'fora_janela') return 'invalidated';
    return elapsedMinutes >= Number(presence.minimum_period_minutes ?? 120) ? 'completed' : 'invalidated';
  }

  /* Constrói um registro de atendimento (vez ou simples) + notifica o corretor em tempo real. */
  private async recordAttendance(
    tenantId: string,
    opts: {
      presenceId: string;
      brokerId: string;
      booth: Booth;
      atorId: string;
      tipo: 'vez' | 'simples';
      inSequence: boolean;
      message: string;
    },
  ) {
    const record = this.attendanceRepository.create({
      tenant_id: tenantId,
      presence_id: opts.presenceId,
      broker_id: opts.brokerId,
      booth_id: opts.booth.id,
      tipo: opts.tipo,
      in_sequence: opts.inSequence,
      attended_at: new Date(),
      attended_by_user_id: opts.atorId,
    });
    const saved = await this.attendanceRepository.save(record);

    this.realtimeService.publish({
      eventType: 'attendance.called',
      tenantId,
      aggregateId: saved.id,
      payload: {
        attendanceId: saved.id,
        presenceId: saved.presence_id,
        brokerId: saved.broker_id,
        boothId: saved.booth_id,
        boothName: opts.booth.name,
        tipo: saved.tipo,
        message: opts.message,
        attendedAt: saved.attended_at,
      },
    });
    return saved;
  }

  private async getHolidayForBoothAndDate(boothId: string, tenantId: string, targetDate: Date = new Date()): Promise<{ isHoliday: boolean; name?: string; roletaTime?: string }> {
    try {
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
    } catch (err) {
      console.error('[PRESENCES] Erro ao verificar feriado:', err);
    }
    return { isHoliday: false };
  }

  private async getSpecialScheduleForBooth(
    boothId: string,
    tenantId: string,
    tzNow: TimezoneNow,
  ): Promise<{ isSpecial: boolean; name?: string; roletaTime?: string; scope?: string }> {
    try {
      // 1. Soberania Máxima: Horário Especial Pontual / Específico na Data de Hoje (one_off)
      const oneOff = await this.specialScheduleRepository.findOne({
        where: { booth_id: boothId, tenant_id: tenantId, scope: 'one_off', specific_date: tzNow.dateStr },
      });
      if (oneOff) {
        return { isSpecial: true, name: oneOff.description, roletaTime: oneOff.roleta_time, scope: 'one_off' };
      }

      // 2. Soberania Recorrente: Horário Especial para o Dia da Semana de Hoje (recurring)
      const recurring = await this.specialScheduleRepository.findOne({
        where: { booth_id: boothId, tenant_id: tenantId, scope: 'recurring', day_of_week: tzNow.dayOfWeek },
      });
      if (recurring) {
        return { isSpecial: true, name: recurring.description, roletaTime: recurring.roleta_time, scope: 'recurring' };
      }
    } catch (err) {
      console.error('[PRESENCES] Erro ao verificar horário especial:', err);
    }
    return { isSpecial: false };
  }

  // 1. Algoritmo Privado de Haversine (Cálculo de Distância Geográfica)
  private calculateDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distância em metros
    
    return distance;
  }

  private getNextConfirmationAt(from: Date, intervalMinutes: number): Date {
    const interval = Math.max(1, Number(intervalMinutes) || 30);
    return new Date(from.getTime() + interval * 60 * 1000);
  }

  private getConfirmationToleranceMinutes(ruleSet: BoothRuleSet): number {
    return Math.max(1, Number(ruleSet.ping_response_deadline_minutes ?? 5));
  }

  // Determina se uma presença está abandonada (zumbi): sem qualquer confirmação recente.
  // Usa os intervalos configurados do plantão + folga, com piso de segurança.
  private isPresenceStale(presence: { status: string; last_confirmed_at: Date | null; check_in_at: Date; check_out_at?: Date | null }, ruleSet?: BoothRuleSet, now: Date = new Date()): boolean {
    if (presence.status !== 'online' && presence.status !== 'absent') return false;
    const intervalMinutes = Number(ruleSet?.ping_interval_minutes ?? 25);
    const deadlineMinutes = Number(ruleSet?.ping_response_deadline_minutes ?? 5);
    const maxIdleMinutes = Math.max(60, intervalMinutes + deadlineMinutes + 90);
    const anchor = presence.last_confirmed_at || presence.check_in_at || presence.check_out_at;
    if (!anchor) return false;
    const idleMinutes = Math.floor((now.getTime() - new Date(anchor).getTime()) / 1000 / 60);
    return idleMinutes > maxIdleMinutes;
  }

  // Finaliza automaticamente períodos antigos abandonados (online/absent) validando apenas até a última confirmação.
  private async autoFinalizeStalePresences(brokerId: string, tenantId: string, currentNow: Date = new Date()) {
    const stalePresences = await this.presenceRepository.find({
      where: [
        { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
        { broker_id: brokerId, tenant_id: tenantId, status: 'absent' },
      ],
      order: { check_in_at: 'DESC' },
    });

    for (const presence of stalePresences) {
      const booth = presence.booth_id
        ? await this.boothRepository.findOne({ where: { id: presence.booth_id, tenant_id: tenantId } })
        : null;
      const ruleSet = booth ? await this.getRuleSetForBooth(booth) : undefined;

      if (!this.isPresenceStale(presence, ruleSet, currentNow)) continue;

      const countStart = presence.validation_starts_at || presence.check_in_at;
      const countEnd = presence.last_confirmed_at || presence.check_in_at || countStart;
      const diffInMs = Math.max(0, countEnd.getTime() - countStart.getTime());
      const accumulatedMinutes = Math.max(0, Math.floor(diffInMs / 1000 / 60));

      presence.accumulated_minutes = accumulatedMinutes;
      presence.check_out_at = countEnd;
      presence.status = this.resolveFinalStatus(presence, accumulatedMinutes);
      const saved = await this.presenceRepository.save(presence);

      // Encerra pings pendentes para impedir que um ping antigo "reviva" a presença finalizada
      const pendingPings = await this.logRepository.find({
        where: { presence_id: presence.id, response_status: 'pending' },
      });
      for (const p of pendingPings) {
        p.response_status = 'no_response';
        p.responded_at = currentNow;
        await this.logRepository.save(p);
      }

      this.realtimeService.publish({ eventType: 'presence.checked_out', tenantId, aggregateId: saved.id, payload: { brokerId, boothId: saved.booth_id, status: saved.status, accumulatedMinutes: saved.accumulated_minutes, reason: 'auto_finalized' } });
      console.log(`[AUTO-FINALIZE] Presença ${saved.id} (${saved.status}) finalizada automaticamente ao iniciar novo período.`);
    }
  }

  // Manutenção em lote: finaliza TODAS as presenças online/absent sem `attended_at` de um tenant,
  // liberando a fila e permitindo novos check-ins. Atenção: presenças suspensas pelo Dead Man's
  // Switch já possuem `check_out_at` preenchido, então o filtro é por status + atendimento, não
  // por check_out_at. Se forceAll=true, finaliza mesmo presenças recentes (não somente as stale).
  async finalizeAllStalePresences(tenantId: string, forceAll: boolean = false): Promise<{ total: number; finalized: Array<{ id: string; brokerId: string; status: string; accumulatedMinutes: number }> }> {
    const stalePresences = await this.presenceRepository.find({
      where: [
        { tenant_id: tenantId, status: 'online', attended_at: IsNull() },
        { tenant_id: tenantId, status: 'absent', attended_at: IsNull() },
      ],
      order: { check_in_at: 'DESC' },
    });

    const now = new Date();
    const finalized: Array<{ id: string; brokerId: string; status: string; accumulatedMinutes: number }> = [];

    for (const presence of stalePresences) {
      const booth = presence.booth_id
        ? await this.boothRepository.findOne({ where: { id: presence.booth_id, tenant_id: tenantId } })
        : null;
      const ruleSet = booth ? await this.getRuleSetForBooth(booth) : undefined;

      if (!forceAll && !this.isPresenceStale(presence, ruleSet, now)) continue;

      const countStart = presence.validation_starts_at || presence.check_in_at;
      const countEnd = presence.last_confirmed_at || presence.check_in_at || countStart;
      const diffInMs = Math.max(0, countEnd.getTime() - new Date(countStart).getTime());
      const accumulatedMinutes = Math.max(0, Math.floor(diffInMs / 1000 / 60));

      presence.accumulated_minutes = 0;
      presence.check_out_at = now;
      presence.status = 'invalidated';
      const saved = await this.presenceRepository.save(presence);

      const pendingPings = await this.logRepository.find({
        where: { presence_id: presence.id, response_status: 'pending' },
      });
      for (const p of pendingPings) {
        p.response_status = 'no_response';
        p.responded_at = now;
        await this.logRepository.save(p);
      }

      this.realtimeService.publish({ eventType: 'presence.checked_out', tenantId, aggregateId: saved.id, payload: { brokerId: saved.broker_id, boothId: saved.booth_id, status: saved.status, accumulatedMinutes: 0, reason: 'maintenance_finalize_all' } });
      finalized.push({ id: saved.id, brokerId: saved.broker_id, status: saved.status, accumulatedMinutes: 0 });
    }

    console.log(`[MAINTENANCE] Finalizei ${finalized.length} presenças pendentes no tenant ${tenantId}.`);
    return { total: finalized.length, finalized };
  }

  // 2. Realiza o Check-in com validação por Dupla Camada (GPS ou Wi-Fi)
  async checkIn(dto: CheckInDto, brokerId: string, tenantId: string) {

  

    // A. Auto-limpeza: finaliza períodos antigos abandonados (online/absent de outro dia ou janela)
    // antes de permitir um novo check-in. O Tempo validado para estes períodos fica limitado à última confirmação.
    await this.autoFinalizeStalePresences(brokerId, tenantId);

    // A0. Verifica se o corretor já possui um check-in ativo ("online") no momento
    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
    });

    if (activePresence) {
      throw new BadRequestException('Você já possui um check-in ativo. Finalize o turno atual antes de iniciar outro.');
    }

    // A1. Validação de Estágio e Conformidade do Corretor
    const brokerUser = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId },
    });
    if (!brokerUser || brokerUser.removed_at) {
      throw new NotFoundException('Corretor não localizado no sistema.');
    }
    if (brokerUser.stage_expires_at && new Date(brokerUser.stage_expires_at) <= new Date()) {
      throw new BadRequestException(`Check-in bloqueado. Seu estágio de '${brokerUser.broker_stage || 'treinamento'}' expirou. Solicite a renovação ou promoção junto à Diretoria.`);
    }
    if (brokerUser.status === 'inactive') {
      throw new BadRequestException('Check-in bloqueado. Seu cadastro está inativo ou suspenso. Contate a Diretoria.');
    }

    // B. Busca o plantão de vendas solicitado e suas regras vigentes
    const booth = await this.boothRepository.findOne({
      where: { id: dto.boothId, tenant_id: tenantId },
      relations: { wifis: true },
    });

    if (!booth) {
      throw new NotFoundException('Plantão de vendas não localizado.');
    }

    // Regra: Bloqueia check-in em estandes não publicados
    if (booth.lifecycle_status !== 'published') {
      throw new BadRequestException('Check-in não permitido. Este plantão de vendas não está publicado para atendimento.');
    }

    const ruleSet = await this.getRuleSetForBooth(booth);

    // A2. Estágio permitido nas regras vigentes do plantão. Se o estágio não estiver liberado,
    // o corretor AINDA pode fazer check-in para atendimento, mas como "fora da janela"
    // (registrado sem validação de período e fora da sequência da roleta).
    const allowedStages: string[] = (ruleSet as any).allowed_broker_stages ?? ALL_BROKER_STAGES;
    const stageAllowed =
      Array.isArray(allowedStages) &&
      allowedStages.length > 0 &&
      allowedStages.includes(brokerUser.broker_stage || 'corretor_creci');

    // C. Validação de Proximidade (DUPLA CAMADA: Wi-Fi do Plantão ou GPS) [7]
    let isLocationValid = false;
    let methodUsed = '';
    let distanceCalculated = 0;

    // 1ª Camada: Validação por BSSID/SSID de Wi-Fi Cadastrado no Plantão
    if (dto.ssid && booth.wifis && booth.wifis.length > 0) {
      const userSsid = dto.ssid;
      const wifiMatch = booth.wifis.some(
        (wifi) => wifi.ssid.toLowerCase() === userSsid.toLowerCase(),
      );

      if (wifiMatch) {
        isLocationValid = true;
        methodUsed = `Wi-Fi Corporativo (${userSsid})`;
      }
    }

    // 2ª Camada: Validação por Raio Geográfico (GPS)
    if (!isLocationValid) {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException('Coordenadas GPS não informadas e Wi-Fi do plantão não detectado.');
      }

      // Validação de frescor da coordenada GPS (Prevenção de cache antigo / fraude)
      if (dto.capturedAt === undefined || dto.capturedAt === null) {
        throw new BadRequestException('Timestamp da coordenada GPS não informado. Atualize o aplicativo e tente novamente.');
      }
      const nowMs = Date.now();
      const ageMs = nowMs - Number(dto.capturedAt);
      const MAX_LOCATION_AGE_MS = 5 * 60 * 1000; // 5 minutos (folga p/ latencia e clock skew do aparelho)
      if (ageMs > MAX_LOCATION_AGE_MS || ageMs < -5 * 60 * 1000) {
        throw new BadRequestException('A coordenada GPS informada está desatualizada ou com horário inconsistente. Obtenha uma nova localização e tente novamente.');
      }

      const boothLat = Number(booth.latitude);
      const boothLon = Number(booth.longitude);
      if (booth.latitude == null || booth.longitude == null || isNaN(boothLat) || isNaN(boothLon)) {
        throw new BadRequestException('Plantão de vendas sem coordenadas geográficas (GPS) cadastradas. Contate o administrador.');
      }

      distanceCalculated = this.calculateDistanceInMeters(
        Number(dto.latitude),
        Number(dto.longitude),
        boothLat,
        boothLon,
      );

      const allowedRadius = ruleSet.gps_radius_meters || booth.gps_radius || 200;
      if (distanceCalculated <= allowedRadius) {
        isLocationValid = true;
        methodUsed = `GPS (${Math.round(distanceCalculated)}m)`;
      } else {
        throw new BadRequestException(
          `Check-in recusado: você está a aproximadamente ${Math.round(distanceCalculated)}m do plantão. O raio permitido é de ${allowedRadius}m. Aproxime-se do estande ou conecte-se ao Wi-Fi oficial do plantão.`,
        );
      }
    }

    if (!isLocationValid) {
      throw new BadRequestException(
        `Check-in recusado. Não conseguimos determinar sua localização. Se você estiver no plantão de vendas, conecte-se à rede Wi-Fi oficial do plantão e tente novamente.`,
      );
    }

    const now = new Date();
    const tzNowForRoleta = getNowInTimezone('America/Sao_Paulo');
    const { nowMinutes, roletaTimes, earlyMinutes, posBarraMinutes, matchingRoleta } = await this.resolveRoletaForBooth(booth);

    let assignedRoletaName: string | null = null;
    let assignedEntryType: 'pontual' | 'pos_barra' | 'fora_janela' = 'pontual';
    let assignedValidationStartsAt: Date | null = now;
    let assignedPosition: number | null = null;
    let assignedDrawTimeStr = '09:01';

    // NOVA REGRA (nova identidade): corretor registrado pode fazer check-in a qualquer momento em
    // qualquer plantão. Fora da janela de validade (sem roleta aberta) OU com estágio não liberado
    // aqui = check-in "fora da janela": REGISTRA a presença (aparece na fila/históricos e pode ser
    // atendido pela Recepção), mas NÃO valida o período nem entra na sequência da roleta.
    // Comportamento legado (flag desligado): continua REJEITANDO check-in fora da janela/estágio.
    const novaIdentidade = await this.isNovaIdentidade(tenantId);
    const isOutOfWindow = !matchingRoleta || !stageAllowed;

    if (novaIdentidade) {
      if (isOutOfWindow) {
        assignedEntryType = 'fora_janela';
        assignedRoletaName = matchingRoleta?.name || null;
        assignedValidationStartsAt = null; // Sem âncora de validação → sempre finaliza invalidado
        assignedDrawTimeStr = matchingRoleta?.drawTimeFormatted || '';
      } else {
        assignedRoletaName = matchingRoleta!.name;
        assignedDrawTimeStr = matchingRoleta!.drawTimeFormatted;

        // Âncora oficial: sempre o horário cheio cadastrado da roleta, nunca o timestamp real do check-in.
        const roletaAnchor = getDateAtTimeInTimezone(
          tzNowForRoleta.dateStr,
          minutesToTimeString(matchingRoleta!.roletaMinutes),
        );

        if (matchingRoleta!.isPontual) {
          assignedEntryType = 'pontual';
          assignedValidationStartsAt = roletaAnchor;
          assignedPosition = null; // Fica aguardando o sorteio automático exatamente às 09:01 / 13:31 / 14:01
        } else {
          assignedEntryType = 'pos_barra';
          assignedValidationStartsAt = roletaAnchor; // Mesma âncora do pontual: início sempre no horário cheio da roleta

          // Pós-Barra entra automaticamente no final da fila.
          const existingInBooth = await this.presenceRepository.find({
            where: {
              booth_id: dto.boothId,
              tenant_id: tenantId,
              status: 'online',
              roleta_name: assignedRoletaName,
            },
          });
          const positionedCount = existingInBooth.filter((p) => p.roleta_position !== null).length;
          const unplacedPontualCount = existingInBooth.filter(
            (p) => p.roleta_position === null && p.roleta_entry_type === 'pontual',
          ).length;
          assignedPosition = positionedCount + unplacedPontualCount + 1;
        }
      }
    } else if (!isOutOfWindow) {
      // Legado: mesma trava estrita de janela + estágio liberado para aceitar o check-in.
      assignedRoletaName = matchingRoleta!.name;
      assignedDrawTimeStr = matchingRoleta!.drawTimeFormatted;

      const roletaAnchor = getDateAtTimeInTimezone(
        tzNowForRoleta.dateStr,
        minutesToTimeString(matchingRoleta!.roletaMinutes),
      );

      if (matchingRoleta!.isPontual) {
        assignedEntryType = 'pontual';
        assignedValidationStartsAt = roletaAnchor;
        assignedPosition = null; // Fica aguardando o sorteio automático exatamente às 09:01 / 13:31 / 14:01
      } else {
        assignedEntryType = 'pos_barra';
        assignedValidationStartsAt = roletaAnchor; // Mesma âncora do pontual: início sempre no horário cheio da roleta

        const existingInBooth = await this.presenceRepository.find({
          where: {
            booth_id: dto.boothId,
            tenant_id: tenantId,
            status: 'online',
            roleta_name: assignedRoletaName,
          },
        });
        const positionedCount = existingInBooth.filter((p) => p.roleta_position !== null).length;
        const unplacedPontualCount = existingInBooth.filter(
          (p) => p.roleta_position === null && p.roleta_entry_type === 'pontual',
        ).length;
        assignedPosition = positionedCount + unplacedPontualCount + 1;
      }
    } else {
      // Legado: fora da janela ou com estágio bloqueado → REJEITA (comportamento original).
      if (!matchingRoleta) {
        const allowedWindows = roletaTimes.map((r) => {
          const roletaMin = timeStringToMinutes(r.time);
          const earlyStr = minutesToTimeString(roletaMin - earlyMinutes);
          const drawStr = minutesToTimeString(roletaMin + 1);
          const endStr = minutesToTimeString(roletaMin + posBarraMinutes);
          return `${r.name} (Check-in das ${earlyStr} às ${endStr} · Sorteio às ${drawStr})`;
        }).join(' | ');

        throw new BadRequestException(
          `Check-in fora do horário permitido para o plantão '${booth.name}'. Janelas de Check-in hoje: ${allowedWindows}.`,
        );
      }
      throw new BadRequestException(
        `Check-in bloqueado. Este plantão não está liberado para corretores em fase '${brokerUser.broker_stage || 'treinamento'}'. Fases liberadas: ${allowedStages.join(', ')}.`,
      );
    }

    const presence = this.presenceRepository.create({
      tenant_id: tenantId,
      broker_id: brokerId,
      booth_id: dto.boothId,
      rule_set_id: ruleSet.id || null,
      minimum_period_minutes: ruleSet.minimum_period_minutes,
      period_weight: ruleSet.period_weight,
      minimum_monthly_periods: ruleSet.minimum_monthly_periods,
      roleta_name: assignedRoletaName,
      roleta_entry_type: assignedEntryType,
      roleta_position: assignedPosition,
      validation_starts_at: assignedValidationStartsAt,
      check_in_at: now,
      last_confirmed_at: now,
      next_confirmation_at: this.getNextConfirmationAt(now, ruleSet.ping_interval_minutes),
      status: 'online',
    });

    const savedPresence = await this.presenceRepository.save(presence);
    void this.userRepository.update({ id: brokerId }, { last_checkin_at: now });
    this.realtimeService.publish({ eventType: 'presence.checked_in', tenantId, aggregateId: savedPresence.id, payload: { brokerId, boothId: dto.boothId, status: savedPresence.status, nextConfirmationAt: savedPresence.next_confirmation_at, roletaPosition: savedPresence.roleta_position, roletaEntryType: savedPresence.roleta_entry_type, drawTimeFormatted: assignedDrawTimeStr } });

    // Tenta processar sorteios pendentes caso o check-in ocorra no marco do sorteio
    void this.processRoletaDraws();

    return {
      message: savedPresence.roleta_entry_type === 'fora_janela'
        ? `Check-in registrado fora da janela de validade do plantão '${booth.name}'. Você pode ser atendido pela Recepção, mas este período NÃO será validado nem entrará na sequência de atendimento.`
        : assignedEntryType === 'pos_barra'
        ? `Check-in Pós-Barra confirmado! Você assumiu o ${assignedPosition}º Lugar no final da fila.`
        : `Check-in Pontual confirmado! Aguarde o sorteio da Roleta exatamente às ${assignedDrawTimeStr}.`,
      presenceId: savedPresence.id,
      roletaName: savedPresence.roleta_name,
      roletaEntryType: savedPresence.roleta_entry_type,
      roletaPosition: savedPresence.roleta_position,
      drawTimeFormatted: assignedDrawTimeStr,
      methodUsed: methodUsed,
      distanceInMeters: Math.round(distanceCalculated),
      outOfWindow: savedPresence.roleta_entry_type === 'fora_janela',
    };
  }

  private async resolveRoletaForBooth(booth: Booth): Promise<{
    ruleSet: BoothRuleSet;
    nowMinutes: number;
    roletaTimes: Array<{ name: string; time: string }>;
    earlyMinutes: number;
    posBarraMinutes: number;
    matchingRoleta: {
      name: string;
      roletaMinutes: number;
      earlyOpenMinutes: number;
      drawMinutes: number;
      drawTimeFormatted: string;
      posBarraEndMinutes: number;
      isPontual: boolean;
      isPosBarra: boolean;
    } | null;
  }> {
    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const nowMinutes = tzNow.nowMinutes;
    const ruleSet = await this.getRuleSetForBooth(booth);
    const specialInfo = await this.getSpecialScheduleForBooth(booth.id, booth.tenant_id, tzNow);
    const holidayInfo = await this.getHolidayForBoothAndDate(booth.id, booth.tenant_id, new Date());

    let roletaTimes: Array<{ name: string; time: string }> = [];
    if (specialInfo.isSpecial) {
      // Horário Especial é SOBERANO (Roleta Única)
      roletaTimes = [{
        name: `Horário Especial (${specialInfo.name || 'Roleta Única'})`,
        time: specialInfo.roletaTime || '12:00',
      }];
    } else if (holidayInfo.isHoliday) {
      roletaTimes = [{
        name: `Roleta Feriado (${holidayInfo.name || 'Roleta Única'})`,
        time: holidayInfo.roletaTime || ruleSet.roleta_weekend_time || '09:00',
      }];
    } else if (tzNow.isWeekend) {
      roletaTimes = [{ name: 'Roleta Fim de Semana', time: ruleSet.roleta_weekend_time || '09:00' }];
    } else {
      roletaTimes = [
        { name: 'Roleta 1 (Manhã)', time: ruleSet.roleta_1_time || '09:00' },
        { name: 'Roleta 2 (Tarde)', time: ruleSet.roleta_2_time || '14:00' },
        ...(ruleSet.roleta_3_time ? [{ name: 'Roleta 3 (Noite)', time: ruleSet.roleta_3_time }] : []),
      ];
    }

    const earlyMinutes = Number(ruleSet.checkin_early_minutes ?? 30);
    const posBarraMinutes = Number(ruleSet.pos_barra_minutes ?? 30);

    let matchingRoleta: {
      name: string;
      roletaMinutes: number;
      earlyOpenMinutes: number;
      drawMinutes: number;
      drawTimeFormatted: string;
      posBarraEndMinutes: number;
      isPontual: boolean;
      isPosBarra: boolean;
    } | null = null;
    for (const r of roletaTimes) {
      const roletaMinutes = timeStringToMinutes(r.time);
      const earlyOpenMinutes = roletaMinutes - earlyMinutes;
      const drawMinutes = roletaMinutes + 1;
      const posBarraEndMinutes = roletaMinutes + posBarraMinutes;

      if (nowMinutes >= earlyOpenMinutes && nowMinutes <= posBarraEndMinutes) {
        matchingRoleta = {
          name: r.name,
          roletaMinutes,
          earlyOpenMinutes,
          drawMinutes,
          drawTimeFormatted: minutesToTimeString(drawMinutes),
          posBarraEndMinutes,
          isPontual: nowMinutes < drawMinutes,
          isPosBarra: nowMinutes >= drawMinutes && nowMinutes <= posBarraEndMinutes,
        };
        break;
      }
    }

    return { ruleSet, nowMinutes, roletaTimes, earlyMinutes, posBarraMinutes, matchingRoleta };
  }

  private async assertCanOperateBooth(actor: { sub: string; role: string }, tenantId: string, boothId: string) {
    if (['diretoria_level_1', 'gerencia_level_2', 'platform_admin_level_0'].includes(actor.role)) return;

    if (actor.role === 'recepcao_level_3') {
      const assignment = await this.receptionistRepository.findOne({
        where: { receptionist_id: actor.sub, booth_id: boothId, tenant_id: tenantId, is_active: true },
      });
      if (!assignment) {
        throw new ForbiddenException('Esta recepção não está vinculada a este plantão. Ação permitida somente nos plantões atribuídos.');
      }
      return;
    }

    throw new ForbiddenException('Ação restrita à Diretoria, Gerência, Recepção ou Admin da plataforma.');
  }

  private async getRuleSetForBooth(booth: Booth): Promise<BoothRuleSet> {
    try {
      const ruleSet = await this.ruleSetRepository.findOne({
        where: { booth_id: booth.id, tenant_id: booth.tenant_id, is_active: true },
        order: { version: 'DESC' },
      });
      if (ruleSet) return ruleSet;
    } catch (error) {
      console.error('[PRESENCE_RULES] Falha ao carregar regras; usando fallback do plantão:', error instanceof Error ? error.message : String(error));
    }

    return this.ruleSetRepository.create({
      id: '',
      tenant_id: booth.tenant_id,
      booth_id: booth.id,
      version: 1,
      is_active: true,
      minimum_period_minutes: 120,
      period_weight: 1,
      saturday_required_periods: 5,
      sunday_required_periods: 6,
      opening_time: null,
      closing_time: null,
      checkin_tolerance_minutes: 0,
      checkout_tolerance_minutes: 0,
      ping_interval_minutes: 30,
      ping_response_deadline_minutes: 5,
      minimum_brokers_required: booth.min_brokers_required,
      gps_radius_meters: booth.gps_radius,
      weekend_enabled: true,
      minimum_monthly_periods: 20,
      allowed_broker_stages: ALL_BROKER_STAGES,
      created_by: null,
    });
  }

  // 3. Realiza o Check-out voluntário e calcula o tempo total acumulado em minutos
  async checkOut(brokerId: string, tenantId: string) {
    const activePresence = await this.presenceRepository.findOne({
      where: [
        { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
        { broker_id: brokerId, tenant_id: tenantId, status: 'absent' },
      ],
      order: { check_in_at: 'DESC' },
    });

    if (!activePresence) {
      throw new NotFoundException('Você não possui nenhum check-in ativo para finalizar.');
    }

    const now = new Date();
    const countStart = activePresence.validation_starts_at || activePresence.check_in_at;
    // Presenças suspensas (absent) não podem contabilizar o período de inatividade:
    // valida apenas até a última confirmação de permanência.
    const countEnd =
      activePresence.status === 'absent'
        ? (activePresence.last_confirmed_at || activePresence.check_in_at)
        : now;
    const diffInMs = Math.max(0, countEnd.getTime() - countStart.getTime());
    const elapsedMinutes = Math.max(0, Math.floor(diffInMs / 1000 / 60));

    activePresence.check_out_at = now;
    activePresence.accumulated_minutes = elapsedMinutes;
    activePresence.status = this.resolveFinalStatus(activePresence, elapsedMinutes);

    const savedPresence = await this.presenceRepository.save(activePresence);

    // Encerra pings pendentes do período finalizado para evitar respostas tardias
    const leftoverPings = await this.logRepository.find({
      where: { presence_id: activePresence.id, response_status: 'pending' },
    });
    for (const leftover of leftoverPings) {
      leftover.response_status = 'no_response';
      leftover.responded_at = now;
      await this.logRepository.save(leftover);
    }
    this.realtimeService.publish({ eventType: 'presence.checked_out', tenantId, aggregateId: savedPresence.id, payload: { brokerId, boothId: savedPresence.booth_id, status: savedPresence.status, accumulatedMinutes: savedPresence.accumulated_minutes } });

    // DISPARA O ALERTA PREDITIVO DE COBERTURA BAIXA NA SAÍDA DO CORRETOR [6]
    await this.checkAndNotifyLowCoverage(activePresence.booth_id, tenantId);

    return {
      message: activePresence.roleta_entry_type === 'fora_janela'
        ? 'Check-out realizado. Registro fora da janela de validade — este período não será validado.'
        : elapsedMinutes >= activePresence.minimum_period_minutes
        ? 'Check-out realizado com sucesso! Período contabilizado.'
        : `Check-out realizado. O período foi invalidado por não atingir o mínimo de ${activePresence.minimum_period_minutes} minutos.`,
      presenceId: savedPresence.id,
      checkInAt: savedPresence.check_in_at,
      checkOutAt: savedPresence.check_out_at,
      nextConfirmationAt: null,
      totalMinutes: savedPresence.accumulated_minutes,
    };
  }

  async getBrokerDashboardSummary(brokerId: string, tenantId: string) {
    // Processa sorteios pendentes de forma preventiva antes de retornar os dados
    await this.processRoletaDraws();

    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
    });
    const activeBooth = activePresence
      ? await this.boothRepository.findOne({ where: { id: activePresence.booth_id, tenant_id: tenantId } })
      : null;
    const activeRuleSet = activeBooth ? await this.getRuleSetForBooth(activeBooth) : undefined;
    const weeklyMetrics = await this.getCurrentWeekPeriodMetrics(brokerId, tenantId);
    const accumulatedPeriods = weeklyMetrics.weightedPeriods;
    const eligibility = await this.checkWeekendEligibility(brokerId, tenantId, activeRuleSet, accumulatedPeriods, activeBooth?.id);
    const activeMinutes = activePresence
      ? Math.max(0, Math.floor((Date.now() - new Date(activePresence.validation_starts_at || activePresence.check_in_at).getTime()) / 1000 / 60))
      : 0;
    const minimumMinutes = activePresence?.minimum_period_minutes || activeRuleSet?.minimum_period_minutes || 120;

    let drawTimeFormatted = '09:01';
    let waitingBrokersCount = 0;

    if (activePresence && activeBooth) {
      const tzNow = getNowInTimezone('America/Sao_Paulo');
      const specialInfo = await this.getSpecialScheduleForBooth(activeBooth.id, tenantId, tzNow);
      const holidayInfo = await this.getHolidayForBoothAndDate(activeBooth.id, tenantId, new Date());

      let roletaTimes: Array<{ name: string; time: string }> = [];
      if (specialInfo.isSpecial) {
        // Horário Especial é SOBERANO (Roleta Única)
        roletaTimes = [{
          name: `Horário Especial (${specialInfo.name || 'Roleta Única'})`,
          time: specialInfo.roletaTime || '12:00',
        }];
      } else if (holidayInfo.isHoliday) {
        roletaTimes = [{
          name: `Roleta Feriado (${holidayInfo.name || 'Roleta Única'})`,
          time: holidayInfo.roletaTime || activeRuleSet?.roleta_weekend_time || '09:00',
        }];
      } else if (tzNow.isWeekend) {
        roletaTimes = [{ name: 'Roleta Fim de Semana', time: activeRuleSet?.roleta_weekend_time || '09:00' }];
      } else {
        roletaTimes = [
          { name: 'Roleta 1 (Manhã)', time: activeRuleSet?.roleta_1_time || '09:00' },
          { name: 'Roleta 2 (Tarde)', time: activeRuleSet?.roleta_2_time || '14:00' },
          ...(activeRuleSet?.roleta_3_time ? [{ name: 'Roleta 3 (Noite)', time: activeRuleSet.roleta_3_time }] : []),
        ];
      }

      const match = roletaTimes.find((r) => r.name === activePresence.roleta_name) || roletaTimes[0];
      if (match) {
        const roletaMin = timeStringToMinutes(match.time);
        drawTimeFormatted = minutesToTimeString(roletaMin + 1);
      }

      if (!activePresence.roleta_position && activePresence.roleta_entry_type === 'pontual') {
        waitingBrokersCount = await this.presenceRepository.count({
          where: {
            booth_id: activePresence.booth_id,
            tenant_id: tenantId,
            status: 'online',
            roleta_name: activePresence.roleta_name || undefined,
            roleta_entry_type: 'pontual',
            roleta_position: IsNull(),
          },
        });
      }
    }

    // Busca a fila completa da roleta no plantão onde o corretor está ativo (apenas após o sorteio)
    let boothQueue: any[] = [];
    let myEffectivePosition: number | null = null;
    if (activePresence && activePresence.roleta_name && (activePresence.roleta_position || activePresence.roleta_entry_type === 'pos_barra')) {
      const novaIdentidade = await this.isNovaIdentidade(tenantId);
      const queue = await this.getEffectiveQueue(activePresence.booth_id, tenantId, activePresence.roleta_name, novaIdentidade);
      boothQueue = queue.map((p) => ({
        ...p,
        roletaPosition: p.effectivePosition,
        originalRoletaPosition: p.roletaPosition,
        isCurrentBroker: p.brokerId === brokerId,
      }));
      const myItem = queue.find((p) => p.brokerId === brokerId);
      myEffectivePosition = myItem ? myItem.effectivePosition : null;
    }

    // Busca todos os plantões publicados da construtora para detalhar as roletas por estande
    const booths = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
      order: { name: 'ASC' },
    });

    const boothsEligibility = await Promise.all(
      booths.map(async (booth) => {
        const ruleSet = await this.getRuleSetForBooth(booth);
        const boothMetrics = await this.getCurrentWeekPeriodMetrics(brokerId, tenantId, booth.id);
        const satReq = ruleSet.saturday_required_periods ?? 5;
        const sunReq = ruleSet.sunday_required_periods ?? 6;
        const satEligible = ruleSet.weekend_enabled !== false && boothMetrics.validPeriods >= satReq;
        const sunEligible = ruleSet.weekend_enabled !== false && boothMetrics.validPeriods >= sunReq;

        return {
          boothId: booth.id,
          boothName: booth.name,
          validRoletasThisWeek: boothMetrics.validPeriods,
          saturdayRequired: satReq,
          sundayRequired: sunReq,
          saturdayEligible: satEligible,
          sundayEligible: sunEligible,
          missingSaturday: Math.max(0, satReq - boothMetrics.validPeriods),
          missingSunday: Math.max(0, sunReq - boothMetrics.validPeriods),
          weekendEnabled: ruleSet.weekend_enabled !== false,
        };
      }),
    );

    return {
      week: 'Segunda-feira a Domingo',
      accumulatedPeriods,
      validPeriods: weeklyMetrics.validPeriods,
      weightedPeriods: weeklyMetrics.weightedPeriods,
      invalidatedPeriods: weeklyMetrics.invalidatedPeriods,
      weekendEligibility: eligibility,
      boothsEligibility,
      minimumMinutesPerPeriod: minimumMinutes,
      weekStart: weeklyMetrics.startOfWeek.toISOString(),
      weekEnd: weeklyMetrics.endOfFriday.toISOString(),
      activeShift: activePresence
        ? {
            presenceId: activePresence.id,
            boothId: activePresence.booth_id,
            boothName: activeBooth?.name || 'Plantão Ativo',
            checkInAt: activePresence.check_in_at,
            checkInAtFormatted: new Date(activePresence.check_in_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            drawTimeFormatted,
            activeMinutes,
            minimumMinutes,
            minimumReached: activeMinutes >= minimumMinutes,
            roletaName: activePresence.roleta_name,
            roletaEntryType: activePresence.roleta_entry_type,
            attendedAt: activePresence.attended_at || null,
            roletaPosition: activePresence.attended_at ? null : (myEffectivePosition ?? activePresence.roleta_position),
            effectivePosition: activePresence.attended_at ? null : (myEffectivePosition ?? activePresence.roleta_position),
            originalRoletaPosition: activePresence.attended_at ? null : activePresence.roleta_position,
            waitingDraw: activePresence.roleta_entry_type === 'pontual' && !activePresence.roleta_position,
            waitingBrokersCount,
            boothQueue,
            lastConfirmedAt: activePresence.last_confirmed_at,
            nextConfirmationAt: activePresence.next_confirmation_at,
            confirmationToleranceMinutes: activeRuleSet ? this.getConfirmationToleranceMinutes(activeRuleSet) : 5,
          }
        : null,
    };
  }

  // Consulta consolidada de elegibilidade de fim de semana para a Gerência/Diretoria
  async getTeamWeekendEligibility(actor: { sub: string; role: string }, tenantId: string) {
    const isManager = actor.role === 'gerencia_level_2';
    const userRepo = this.presenceRepository.manager.getRepository(User);
    const brokers = await userRepo.find({
      where: isManager
        ? { tenant_id: tenantId, role: 'corretor_level_3', manager_id: actor.sub, status: 'active', removed_at: IsNull() }
        : { tenant_id: tenantId, role: 'corretor_level_3', status: 'active', removed_at: IsNull() },
      order: { name: 'ASC' },
    });

    const booths = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
      order: { name: 'ASC' },
    });

    const boothRuleSets = new Map<string, BoothRuleSet>();
    for (const booth of booths) {
      boothRuleSets.set(booth.id, await this.getRuleSetForBooth(booth));
    }

    let saturdayEligibleCount = 0;
    let sundayEligibleCount = 0;

    const members = await Promise.all(
      brokers.map(async (broker) => {
        let isEligibleSaturdayAnyBooth = false;
        let isEligibleSundayAnyBooth = false;

        const boothsStatus = await Promise.all(
          booths.map(async (booth) => {
            const ruleSet = boothRuleSets.get(booth.id)!;
            const metrics = await this.getCurrentWeekPeriodMetrics(broker.id, tenantId, booth.id);
            const satReq = ruleSet.saturday_required_periods ?? 5;
            const sunReq = ruleSet.sunday_required_periods ?? 6;
            const satEligible = ruleSet.weekend_enabled !== false && metrics.validPeriods >= satReq;
            const sunEligible = ruleSet.weekend_enabled !== false && metrics.validPeriods >= sunReq;

            if (satEligible) isEligibleSaturdayAnyBooth = true;
            if (sunEligible) isEligibleSundayAnyBooth = true;

            return {
              boothId: booth.id,
              boothName: booth.name,
              validRoletasThisWeek: metrics.validPeriods,
              saturdayRequired: satReq,
              sundayRequired: sunReq,
              saturdayEligible: satEligible,
              sundayEligible: sunEligible,
              missingSaturday: Math.max(0, satReq - metrics.validPeriods),
              missingSunday: Math.max(0, sunReq - metrics.validPeriods),
            };
          }),
        );

        if (isEligibleSaturdayAnyBooth) saturdayEligibleCount += 1;
        if (isEligibleSundayAnyBooth) sundayEligibleCount += 1;

        return {
          brokerId: broker.id,
          name: broker.name,
          nomeGuerra: broker.nome_guerra,
          creci: broker.creci,
          managerId: broker.manager_id,
          isEligibleSaturday: isEligibleSaturdayAnyBooth,
          isEligibleSunday: isEligibleSundayAnyBooth,
          boothsStatus,
        };
      }),
    );

    const fullyEligibleCount = members.filter((m) => m.isEligibleSaturday && m.isEligibleSunday).length;
    const noneEligibleCount = members.filter((m) => !m.isEligibleSaturday && !m.isEligibleSunday).length;

    return {
      totalTeamBrokers: brokers.length,
      saturdayEligibleCount,
      sundayEligibleCount,
      fullyEligibleCount,
      inProgressCount: noneEligibleCount, // não bateu NENHUM dos dois critérios ainda
      members,
    };
  }

  // Busca se o corretor logado já possui uma sessão de check-in ativa (PWA Session Recovery)
  async getCurrentPresence(brokerId: string, tenantId: string) {
    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
      relations: { booth: true },
    });

    if (!activePresence) {
      // Presença suspensa por ausência continua visível para o corretor aguardando revalidação da recepção
      const suspendedPresence = await this.presenceRepository.findOne({
        where: { broker_id: brokerId, tenant_id: tenantId, status: 'absent' },
        relations: { booth: true },
        order: { check_in_at: 'DESC' },
      });
      if (suspendedPresence) {
        // Se a suspensão é antiga (zumbi), finaliza automaticamente e libera um novo check-in
        const booth = suspendedPresence.booth || null;
        const ruleSet = booth ? await this.getRuleSetForBooth(booth) : undefined;
        if (this.isPresenceStale(suspendedPresence, ruleSet)) {
          await this.autoFinalizeStalePresences(brokerId, tenantId);
          return { hasActiveSession: false, presence: null };
        }
        return {
          hasActiveSession: true,
          presence: {
            id: suspendedPresence.id,
            boothId: suspendedPresence.booth_id,
            boothName: suspendedPresence.booth?.name || 'Plantão Ativo',
            checkInAt: suspendedPresence.check_in_at,
            status: suspendedPresence.status,
            pendingPingId: null,
            lastConfirmedAt: suspendedPresence.last_confirmed_at,
            nextConfirmationAt: suspendedPresence.next_confirmation_at,
            confirmationToleranceMinutes: 5,
          },
        };
      }

      return { 
        hasActiveSession: false, 
        presence: null 
      };
    }

    // BUSCA SE EXISTE UM PING PENDENTE NA NUVEM PARA ESSE CORRETOR RESPONDER [8]
    const pendingPing = await this.logRepository.findOne({
      where: { presence_id: activePresence.id, response_status: 'pending' },
      order: { sent_at: 'DESC' },
    });

    // Presença online abandonada (zumbi): finaliza e libera novo check-in
    if (this.isPresenceStale(activePresence, activePresence.booth ? await this.getRuleSetForBooth(activePresence.booth) : undefined)) {
      await this.autoFinalizeStalePresences(brokerId, tenantId);
      return { hasActiveSession: false, presence: null };
    }

    return {
      hasActiveSession: true,
      presence: {
        id: activePresence.id,
        boothId: activePresence.booth_id,
        boothName: activePresence.booth.name,
        checkInAt: activePresence.check_in_at,
        status: activePresence.status,
        pendingPingId: pendingPing ? pendingPing.id : null,
        lastConfirmedAt: activePresence.last_confirmed_at,
        nextConfirmationAt: activePresence.next_confirmation_at,
        confirmationToleranceMinutes: 5,
      },
    };
  }
  // 5. Corretor responde voluntariamente ao Ping de Confirmação periódico [8]
  async respondToPing(dto: PingResponseDto, brokerId: string, tenantId: string) {
    // Busca o log de ping pendente emitido para o inquilino
    const ping = await this.logRepository.findOne({
      where: { id: dto.pingLogId, tenant_id: tenantId, response_status: 'pending' },
      relations: { presence: { booth: { wifis: true } } },
    });

    if (!ping) {
      throw new BadRequestException('Este ping de confirmação não existe, já foi respondido ou expirou.');
    }

    // Valida se o ping pertence ao corretor que está respondendo
    if (ping.presence.broker_id !== brokerId) {
      throw new BadRequestException('Este ping não pertence ao seu usuário.');
    }

    // Presenças finalizadas (checkout/auto-finalização) não podem ser reativadas por um ping antigo
    if (ping.presence.status !== 'online' && ping.presence.status !== 'absent') {
      throw new BadRequestException('Este período já foi finalizado. Faça um novo check-in para iniciar um novo turno.');
    }

    const booth = ping.presence.booth;
    const ruleSet = await this.getRuleSetForBooth(booth);
    let isPresenceValid = false;
    let methodUsed = '';
    let distanceCalculated = 0;

    // A. Validação por Wi-Fi
    if (dto.ssid && booth.wifis && booth.wifis.length > 0) {
      const userSsid = dto.ssid;
      const wifiMatch = booth.wifis.some(
        (wifi) => wifi.ssid.toLowerCase() === userSsid.toLowerCase(),
      );

      if (wifiMatch) {
        isPresenceValid = true;
        methodUsed = 'valid_wifi';
      }
    }

    // B. Validação por GPS (Caso Wi-Fi não bata)
    let effectiveRadius = booth.gps_radius || 200;
    if (!isPresenceValid) {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException('Coordenadas GPS não informadas e Wi-Fi do plantão não detectado.');
      }

      // Validação de frescor da coordenada GPS (Prevenção de cache antigo / fraude no dead man's switch)
      if (dto.capturedAt === undefined || dto.capturedAt === null) {
        throw new BadRequestException('Timestamp da coordenada GPS não informado. Atualize o aplicativo e tente novamente.');
      }
      const nowMs = Date.now();
      const ageMs = nowMs - Number(dto.capturedAt);
      const MAX_LOCATION_AGE_MS = 5 * 60 * 1000; // 5 minutos (folga p/ latencia e clock skew do aparelho)
      if (ageMs > MAX_LOCATION_AGE_MS || ageMs < -5 * 60 * 1000) {
        throw new BadRequestException('A coordenada GPS de confirmação está desatualizada ou com horário inconsistente. Obtenha nova localização e tente novamente.');
      }

      const boothLat = Number(booth.latitude);
      const boothLon = Number(booth.longitude);

      if (booth.latitude == null || booth.longitude == null || isNaN(boothLat) || isNaN(boothLon)) {
        throw new BadRequestException('Plantão de vendas sem coordenadas geográficas (GPS) cadastradas. Contate a Recepção.');
      }

      effectiveRadius = ruleSet?.gps_radius_meters || booth.gps_radius || 200;

      distanceCalculated = this.calculateDistanceInMeters(
        Number(dto.latitude),
        Number(dto.longitude),
        boothLat,
        boothLon,
      );

      if (distanceCalculated <= effectiveRadius) {
        isPresenceValid = true;
        methodUsed = 'valid_gps';
      }
    }

    ping.responded_at = new Date();
    ping.latitude = dto.latitude;
    ping.longitude = dto.longitude;

    if (isPresenceValid) {
      // Se estiver dentro da área, salva o log com sucesso e o corretor permanece ONLINE [8]
      ping.response_status = methodUsed;
      await this.logRepository.save(ping);

      ping.presence.status = 'online';
      ping.presence.last_confirmed_at = new Date();
      ping.presence.next_confirmation_at = this.getNextConfirmationAt(new Date(), ruleSet.ping_interval_minutes);
      await this.presenceRepository.save(ping.presence);
      this.realtimeService.publish({ eventType: 'presence.confirmed', tenantId, aggregateId: ping.presence.id, payload: { brokerId, boothId: ping.presence.booth_id, method: methodUsed, nextConfirmationAt: ping.presence.next_confirmation_at } });

      return {
        message: 'Presença confirmada com sucesso!',
        status: methodUsed,
        distanceInMeters: Math.round(distanceCalculated),
      };
    } else {
      // Se responder estando FORA da área, o período é desconsiderado automaticamente [8]
      ping.response_status = 'outside_area';
      await this.logRepository.save(ping);

      const countStart = ping.presence.validation_starts_at || ping.presence.check_in_at;
      const countEnd = ping.presence.last_confirmed_at || ping.presence.check_in_at || countStart;
      const frozenMinutes = Math.max(0, Math.floor((Math.max(0, countEnd.getTime() - countStart.getTime())) / 1000 / 60));
      ping.presence.accumulated_minutes = frozenMinutes;
      ping.presence.check_out_at = countEnd;
      ping.presence.status = this.resolveFinalStatus(ping.presence, frozenMinutes);
      await this.presenceRepository.save(ping.presence);
      this.realtimeService.publish({ eventType: 'presence.checked_out', tenantId, aggregateId: ping.presence.id, payload: { brokerId, boothId: ping.presence.booth_id, status: ping.presence.status, accumulatedMinutes: ping.presence.accumulated_minutes, reason: 'outside_area_auto_invalidated' } });
      void this.notificationsService.sendToUser(
        brokerId,
        tenantId,
        'Presença desconsiderada',
        `Sua confirmação foi registrada fora do raio de ${effectiveRadius}m do plantão. O período não foi contabilizado na roleta. Aproxime-se do plantão e faça um novo check-in.`,
        { type: 'presence_invalidated', presenceId: ping.presence.id },
      );

      throw new BadRequestException(
        `Presença desconsiderada: você está a aproximadamente ${Math.round(distanceCalculated)}m do plantão, fora do raio de ${effectiveRadius}m permitido. Aproxime-se do plantão e faça um novo check-in.`,
      );
    }
  }

  // 6. Motor interno de sorteio automático da Roleta: executa a cada minuto
  @Cron(CronExpression.EVERY_MINUTE)
  async handleRoletaDrawCron() {
    await this.processRoletaDraws();
  }

  // Realiza o sorteio aleatório da Roleta para todos os plantões no minuto exato configurado (ex: 09:01, 13:31, 14:01)
  async processRoletaDraws() {
    const booths = await this.boothRepository.find({
      where: { lifecycle_status: 'published' },
    });

    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const nowMinutes = tzNow.nowMinutes;

    for (const booth of booths) {
      const ruleSet = await this.getRuleSetForBooth(booth);
      const specialInfo = await this.getSpecialScheduleForBooth(booth.id, booth.tenant_id, tzNow);
      const holidayInfo = await this.getHolidayForBoothAndDate(booth.id, booth.tenant_id, new Date());

      let roletaTimes: Array<{ name: string; time: string }> = [];
      if (specialInfo.isSpecial) {
        // Horário Especial é SOBERANO (Roleta Única)
        roletaTimes = [{
          name: `Horário Especial (${specialInfo.name || 'Roleta Única'})`,
          time: specialInfo.roletaTime || '12:00',
        }];
      } else if (holidayInfo.isHoliday) {
        roletaTimes = [{
          name: `Roleta Feriado (${holidayInfo.name || 'Roleta Única'})`,
          time: holidayInfo.roletaTime || ruleSet.roleta_weekend_time || '09:00',
        }];
      } else if (tzNow.isWeekend) {
        roletaTimes = [{ name: 'Roleta Fim de Semana', time: ruleSet.roleta_weekend_time || '09:00' }];
      } else {
        roletaTimes = [
          { name: 'Roleta 1 (Manhã)', time: ruleSet.roleta_1_time || '09:00' },
          { name: 'Roleta 2 (Tarde)', time: ruleSet.roleta_2_time || '14:00' },
          ...(ruleSet.roleta_3_time ? [{ name: 'Roleta 3 (Noite)', time: ruleSet.roleta_3_time }] : []),
        ];
      }

      for (const r of roletaTimes) {
        const roletaMinutes = timeStringToMinutes(r.time);
        const drawMinutes = roletaMinutes + 1; // 09:01, 13:31, 14:01

        // Se já passou ou atingiu o horário do sorteio (ex: 13:31)
        if (nowMinutes >= drawMinutes) {
          const unplacedPresences = await this.presenceRepository.find({
            where: {
              booth_id: booth.id,
              tenant_id: booth.tenant_id,
              status: 'online',
              roleta_name: r.name,
              roleta_entry_type: 'pontual',
              roleta_position: IsNull(),
            },
            relations: { broker: true },
          });

          if (unplacedPresences.length > 0) {
            // Embaralha aleatoriamente (Sorteio da Roleta)
            const shuffled = [...unplacedPresences].sort(() => Math.random() - 0.5);
            
            const existingPresences = await this.presenceRepository.find({
              where: {
                booth_id: booth.id,
                tenant_id: booth.tenant_id,
                status: 'online',
                roleta_name: r.name,
              },
            });
            const maxExistingPos = existingPresences.reduce((max, p) => Math.max(max, p.roleta_position || 0), 0);

            for (let i = 0; i < shuffled.length; i++) {
              const presence = shuffled[i];
              presence.roleta_position = maxExistingPos + i + 1;
              await this.presenceRepository.save(presence);

              // Dispara notificação push para o corretor com a posição sorteada
              void this.notificationsService.sendToUser(
                presence.broker_id,
                presence.tenant_id,
                `🎰 Sorteio da Roleta Realizado!`,
                `Parabéns, ${presence.broker?.nome_guerra || 'corretor'}! Você tirou o ${presence.roleta_position}º Lugar na fila de atendimento do plantão ${booth.name}.`,
                { type: 'roleta_drawn', presenceId: presence.id, position: presence.roleta_position, boothId: booth.id },
              );
            }

            this.realtimeService.publish({
              eventType: 'roleta.drawn',
              tenantId: booth.tenant_id,
              aggregateId: booth.id,
              payload: {
                boothId: booth.id,
                roletaName: r.name,
                drawnCount: shuffled.length,
              },
            });
            console.log(`[ROLETA] Sorteio realizado no plantão '${booth.name}' (${r.name}): ${shuffled.length} corretor(es) sorteado(s).`);
          }
        }
      }
    }
  }

  // 7. Motor interno de verificação: executa a cada 5 minutos, sem suspender antes da janela configurada.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleDeadMansSwitchCron() {
    console.log('[CRON] Iniciando verificação de permanência (Dead Man\'s Switch)...');
    await this.processPresencesAndPings();
  }

  // 7. Método Auxiliar para processar os Pings (Usado pelo Cron e pela rota de teste manual)
  async processPresencesAndPings() {
    // Busca todas as presenças ativas ("online") no sistema de todas as construtoras [8]
    const activePresences = await this.presenceRepository.find({
      where: { status: 'online' },
    });

    const now = new Date();
    let pingsGenerated = 0;
    let brokersSuspended = 0;

    for (const presence of activePresences) {
      const booth = await this.boothRepository.findOne({
        where: { id: presence.booth_id, tenant_id: presence.tenant_id },
      });
      if (!booth) continue;
      const ruleSet = await this.getRuleSetForBooth(booth);
      const pingIntervalMinutes = Number(ruleSet?.ping_interval_minutes ?? 30);
      const responseDeadlineMinutes = this.getConfirmationToleranceMinutes(ruleSet);

      // Busca se já existe um ping "pendente" lançado anteriormente para essa presença
      const pendingPing = await this.logRepository.findOne({
        where: { presence_id: presence.id, response_status: 'pending' },
        order: { sent_at: 'DESC' },
      });

      if (pendingPing) {
        // O prazo é o configurado no plantão (ping_response_deadline_minutes: padrão 5 min).
        const diffInMs = now.getTime() - pendingPing.sent_at.getTime();
        const minutesElapsed = Math.floor(diffInMs / 1000 / 60);

        if (minutesElapsed >= responseDeadlineMinutes) {
          pendingPing.response_status = 'no_response';
          await this.logRepository.save(pendingPing);

          // DESCONSIDERA o período automaticamente: congela o tempo validado até a última
          // confirmação (o trecho não confirmado não conta) e encerra a presença, liberando
          // o corretor para um novo check-in SEM depender de revalidação manual da recepção.
          const countStart = presence.validation_starts_at || presence.check_in_at;
          const countEnd = presence.last_confirmed_at || presence.check_in_at || countStart;
          const frozenMinutes = Math.max(0, Math.floor((Math.max(0, countEnd.getTime() - countStart.getTime())) / 1000 / 60));
          presence.accumulated_minutes = frozenMinutes;
          presence.check_out_at = countEnd;
          presence.status = this.resolveFinalStatus(presence, frozenMinutes);
          await this.presenceRepository.save(presence);
          this.realtimeService.publish({ eventType: 'presence.checked_out', tenantId: presence.tenant_id, aggregateId: presence.id, payload: { brokerId: presence.broker_id, boothId: presence.booth_id, status: presence.status, accumulatedMinutes: presence.accumulated_minutes, reason: 'no_response_auto_invalidated' } });
          brokersSuspended++;
          console.log(`[CRON] Presença ${presence.id} desconsiderada automaticamente por falta de resposta (${presence.status}).`);
          void this.notificationsService.sendToUser(
            presence.broker_id,
            presence.tenant_id,
            'Presença desconsiderada',
            'Não recebemos sua confirmação de presença dentro do prazo. O período não confirmado não foi contabilizado na roleta. Faça um novo check-in para reiniciar o turno.',
            { type: 'presence_invalidated', presenceId: presence.id },
          );
        }
      } else {
        const lastPing = await this.logRepository.findOne({
          where: { presence_id: presence.id },
          order: { sent_at: 'DESC' },
        });
        const scheduledAt = presence.next_confirmation_at || (lastPing ? this.getNextConfirmationAt(lastPing.sent_at, pingIntervalMinutes) : this.getNextConfirmationAt(presence.check_in_at, pingIntervalMinutes));
        if (now.getTime() < scheduledAt.getTime()) continue;

        // Sem ping pendente e após o próximo marco alinhado, dispara nova confirmação.
        const newPing = this.logRepository.create({
          tenant_id: presence.tenant_id,
          presence_id: presence.id,
          response_status: 'pending',
        });
        await this.logRepository.save(newPing);
        pingsGenerated++;
        console.log(`[CRON] Novo ping pendente gerado para a presença ${presence.id}.`);
        void this.notificationsService.sendToUser(
          presence.broker_id,
          presence.tenant_id,
          'Confirme sua presença',
          'Toque nesta notificação e confirme que você continua no plantão.',
          { type: 'presence_ping', presenceId: presence.id, pingId: newPing.id },
        );
      }
    }

    return {
      processedPresences: activePresences.length,
      pingsGenerated,
      brokersSuspended,
    };
  }

  // 8. Retorna métricas explícitas de períodos da semana atual (Segunda 00:00 a Sexta 23:59).
  private async getCurrentWeekPeriodMetrics(brokerId: string, tenantId: string, boothId?: string) {
    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const currentDay = tzNow.dayOfWeek; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado

    // Calcula o início da Segunda-feira da semana atual ancorado em America/Sao_Paulo
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay; // Ajuste se for Domingo
    const todayAnchor = getDateAtTimeInTimezone(tzNow.dateStr, '00:00');
    const startOfWeek = new Date(todayAnchor);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() + mondayOffset);

    // Calcula o final da Sexta-feira da semana atual (23:59:59.999) em America/Sao_Paulo
    // Usamos ms para evitar reintroduzir o bug com setHours (que opera no fuso local do processo)
    const endOfFriday = new Date(startOfWeek.getTime() + 4 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000 + 999);

    // Busca todas as presenças concluídas no intervalo de segunda a sexta desta semana
    const query = this.presenceRepository.createQueryBuilder('presence')
      .where('presence.broker_id = :brokerId', { brokerId })
      .andWhere('presence.tenant_id = :tenantId', { tenantId })
      .andWhere('presence.status IN (:...statuses)', { statuses: ['completed', 'invalidated'] })
      .andWhere('presence.check_in_at BETWEEN :start AND :end', { start: startOfWeek, end: endOfFriday });

    if (boothId) {
      query.andWhere('presence.booth_id = :boothId', { boothId });
    }

    const presences = await query.getMany();

    const validPresences = presences.filter(
      (presence) => presence.status === 'completed' &&
        Number(presence.accumulated_minutes || 0) >= Number(presence.minimum_period_minutes || 120),
    );
    const invalidatedPresences = presences.filter((presence) => presence.status === 'invalidated');
    const weightedPeriods = validPresences.reduce(
      (sum, presence) => sum + Number(presence.period_weight || 1),
      0,
    );

    return {
      validPeriods: validPresences.length,
      weightedPeriods,
      invalidatedPeriods: invalidatedPresences.length,
      startOfWeek,
      endOfFriday,
    };
  }

  private async getAccumulatedPeriodsForCurrentWeek(brokerId: string, tenantId: string, boothId?: string): Promise<number> {
    const metrics = await this.getCurrentWeekPeriodMetrics(brokerId, tenantId, boothId);
    return metrics.validPeriods;
  }

  // 9. Valida a elegibilidade do corretor para check-in de fim de semana (por plantão) [9]
  private async checkWeekendEligibility(
    brokerId: string,
    tenantId: string,
    ruleSet?: BoothRuleSet,
    accumulatedOverride?: number,
    boothId?: string,
  ): Promise<{ eligible: boolean; checkInAllowedToday: boolean; enabled: boolean; accumulated: number; required: number }> {
    const dayOfWeek = getNowInTimezone('America/Sao_Paulo').dayOfWeek; // 0 = Domingo, 6 = Sábado
    const accumulated = accumulatedOverride !== undefined ? accumulatedOverride : await this.getAccumulatedPeriodsForCurrentWeek(brokerId, tenantId, boothId);
    const enabled = ruleSet?.weekend_enabled !== false;
    const saturdayRequired = ruleSet?.saturday_required_periods ?? 5;
    const sundayRequired = ruleSet?.sunday_required_periods ?? 6;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const required = dayOfWeek === 6 ? saturdayRequired : dayOfWeek === 0 ? sundayRequired : Math.max(saturdayRequired, sundayRequired);
    const eligible = enabled && accumulated >= required;
    const checkInAllowedToday = !isWeekend ? true : eligible;
    return { eligible, checkInAllowedToday, enabled, accumulated, required };
  }

  // 10. ALERTA PREDITIVO DE COBERTURA BAIXA: Verifica e notifica o gerente do plantão [6]
  private async checkAndNotifyLowCoverage(boothId: string, tenantId: string): Promise<void> {
    // 1. Busca os dados do plantão na nuvem
    const booth = await this.boothRepository.findOne({
      where: { id: boothId, tenant_id: tenantId },
    });

    if (!booth || !booth.manager_id) return; // Se não há gerente configurado, ignora
    const ruleSet = await this.getRuleSetForBooth(booth);

    // 2. Conta quantos corretores estão online neste exato momento no plantão [8]
    const onlineBrokersCount = await this.presenceRepository.count({
      where: { booth_id: boothId, tenant_id: tenantId, status: 'online' },
    });

    // 3. Se a quantidade atual for menor do que o mínimo exigido pela Diretoria: dispara o alerta! [6]
    if (onlineBrokersCount < ruleSet.minimum_brokers_required) {
      console.log(`[ALERTA PREDITIVO] Plantão '${booth.name}' está com baixa cobertura: apenas ${onlineBrokersCount} corretor(es) ativo(s).`);

      // 4. Cria um comunicado de urgência automático na tabela de mensagens para o Gerente responsável [12, 13]
      const alertMessage = this.messageRepository.create({
        tenant_id: tenantId,
        sender_id: booth.manager_id, // Enviado em nome do próprio sistema para ele
        title: `⚠️ ALERTA DE COBERTURA BAIXA: Plantão ${booth.name}`,
        content: `O plantão de vendas '${booth.name}' está operando abaixo da capacidade mínima permitida de corretores. Atualmente, há apenas ${onlineBrokersCount} corretor(es) ativo(s). Por favor, verifique a escala imediatamente.`,
        is_urgent: true, // Marcado como urgente (confirmação obrigatória) [13]
      });

      const savedMessage = await this.messageRepository.save(alertMessage);

      // 5. Encaminha para a caixa de entrada do Gerente do plantão [12]
      const recipient = this.recipientRepository.create({
        tenant_id: tenantId,
        message_id: savedMessage.id,
        recipient_id: booth.manager_id,
      });

      await this.recipientRepository.save(recipient);
      void this.notificationsService.sendToUser(
        booth.manager_id,
        tenantId,
        `Alerta de cobertura: ${booth.name}`,
        `O plantão está com ${onlineBrokersCount} corretor(es) online, abaixo do mínimo exigido.`,
        { type: 'low_coverage', messageId: savedMessage.id, boothId: booth.id },
      );
    }
  }

  // 11. Relatório mensal de % de presença do corretor vs. períodos disponíveis [6]
  async getBrokerMonthlyStatistics(brokerId: string, tenantId: string, month: number, year: number, boothId?: string) {
    // Define a data de início e fim do mês selecionado
    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // Consulta única do intervalo mensal; a contagem final é feita após validar a duração mínima.
    // O filtro adicional via QueryBuilder garante precisão no limite de datas.
    const completedPresences = await this.presenceRepository.createQueryBuilder('presence')
      .where('presence.broker_id = :brokerId', { brokerId })
      .andWhere('presence.tenant_id = :tenantId', { tenantId })
      .andWhere('presence.status = :status', { status: 'completed' })
      .andWhere('presence.check_in_at BETWEEN :start AND :end', { start: startOfMonth, end: endOfMonth })
      .andWhere(boothId ? 'presence.booth_id = :boothId' : '1 = 1', boothId ? { boothId } : {})
      .getMany();

    const validCompletedPresences = completedPresences.filter(
      (presence) => presence.accumulated_minutes >= presence.minimum_period_minutes,
    );
    const completedPeriodsWeightSum = validCompletedPresences.reduce((sum, presence) => sum + Number(presence.period_weight || 1), 0);
    const completedPeriodsCount = validCompletedPresences.length;

    const availablePeriodsGoal = validCompletedPresences.length > 0
      ? Math.max(...validCompletedPresences.map((presence) => Number(presence.minimum_monthly_periods || 20)))
      : 20;

    // Calcula a porcentagem de assiduidade real
    const presencePercentage = Math.round((completedPeriodsWeightSum / availablePeriodsGoal) * 100);

    return {
      brokerId,
      month,
      year,
      completedPeriods: completedPeriodsCount,
      completedPeriodsWeightSum,
      monthlyGoal: availablePeriodsGoal,
      boothId: boothId || null,
      presencePercentage: presencePercentage > 100 ? 100 : presencePercentage, // Limita a 100%
    };
  }

  /**
   * Histórico do Corretor: resumo + presenças por dia dentro de um período.
   * Acesso: Diretoria/RH consultam qualquer corretor; Corretor/Recepção apenas o próprio.
   */
  async getBrokerHistory(
    actor: { sub: string; role: string },
    tenantId: string,
    brokerId: string,
    startDateStr?: string,
    endDateStr?: string,
    boothId?: string,
  ) {
    const canViewAll = ['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role);
    const canViewOwn = ['corretor_level_3', 'recepcao_level_3'].includes(actor.role);
    if (!canViewAll && !canViewOwn) {
      throw new ForbiddenException('Acesso restrito ao histórico do corretor.');
    }
    if (!canViewAll && actor.sub !== brokerId) {
      throw new ForbiddenException('Você só pode consultar o seu próprio histórico.');
    }

    const isReceptionSelf = actor.role === 'recepcao_level_3' && actor.sub === brokerId;

    const broker = await this.userRepository.findOne({ where: { id: brokerId, tenant_id: tenantId } });
    if (!broker || broker.removed_at) throw new NotFoundException('Usuário não localizado no sistema.');
    if (!isReceptionSelf && broker.role !== 'corretor_level_3') {
      throw new BadRequestException('O histórico de presença é exclusivo para corretores.');
    }

    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const [curYear, curMonth] = tzNow.dateStr.split('-').map(Number);

    const computeEnd = (endDateStr?: string) =>
      endDateStr
        ? new Date(getDateAtTimeInTimezone(endDateStr, '00:00').getTime() + 24 * 60 * 60 * 1000 - 1)
        : new Date(getDateAtTimeInTimezone(tzNow.dateStr, '00:00').getTime() + 24 * 60 * 60 * 1000 - 1);

    // Período máximo de 3 meses
    let startDate: Date, endDate: Date;
    if (startDateStr) {
      startDate = getDateAtTimeInTimezone(startDateStr, '00:00');
      endDate = computeEnd(endDateStr);
    } else {
      // Sem parâmetros: mês corrente
      startDate = getDateAtTimeInTimezone(`${curYear}-${String(curMonth).padStart(2, '0')}-01`, '00:00');
      endDate = computeEnd(undefined);
    }
    const rangeDays = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (rangeDays > 93) {
      throw new BadRequestException('O período máximo para consulta do histórico é de 3 meses.');
    }

    const query = this.presenceRepository.createQueryBuilder('p')
      .where(isReceptionSelf ? 'p.attended_by_user_id = :brokerId' : 'p.broker_id = :brokerId', { brokerId })
      .andWhere('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.check_in_at BETWEEN :start AND :end', { start: startDate, end: endDate })
      .orderBy('p.check_in_at', 'ASC');
    if (boothId) {
      query.andWhere('p.booth_id = :boothId', { boothId });
    }
    const presences = await query.getMany();
    const now = new Date();

    // Mapa de plantões para exibir nomes
    const boothIds = Array.from(new Set(presences.map((p) => p.booth_id)));
    const booths = boothIds.length
      ? await this.boothRepository.find({ where: { id: In(boothIds), tenant_id: tenantId } })
      : [];
    const boothMap = new Map(booths.map((b) => [b.id, b.name]));

    // Mapa de gerentes
    const managers = await this.userRepository.find({
      where: { tenant_id: tenantId, role: 'gerencia_level_2', removed_at: IsNull() },
    });
    const managerMap = new Map(managers.map((m) => [m.id, m.nome_guerra || m.name]));

    // Nova identidade: agrega os registros de atendimento (vezes/simples da Recepção) ao histórico.
    // Legado: mantém o contrato original (somente presenças, sem campos de atendimento).
    const novaIdentidade = await this.isNovaIdentidade(tenantId);

    const brokerInfo = {
      id: broker.id,
      name: broker.name,
      nomeGuerra: broker.nome_guerra || broker.name,
      creci: broker.creci || null,
      brokerStage: broker.broker_stage || 'corretor_creci',
      managerId: broker.manager_id,
      managerName: broker.manager_id ? (managerMap.get(broker.manager_id) || 'Sem Gerente') : 'Sem Gerente',
      status: broker.status,
      approvedByHr: broker.approved_by_hr,
      carenciaEndsAt: broker.carencia_ends_at,
      stageExpiresAt: broker.stage_expires_at,
      createdAt: broker.created_at,
      lastCheckinAt: broker.last_checkin_at,
    };
    const periodInfo = {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };

    if (novaIdentidade) {
      // REGISTROS DE ATENDIMENTO (novo fluxo): todos os atendimentos vez/simples da Recepção.
      // Na Recepção ("Meu histórico") aparecem os atendimentos feitos pela própria recepção;
      // nos demais perfis, os atendimentos feitos AO corretor consultado.
      const attendanceRecords = isReceptionSelf
        ? await this.attendanceRepository.find({
            where: { tenant_id: tenantId, attended_by_user_id: brokerId, attended_at: Between(startDate, endDate) },
            relations: { booth: true },
            order: { attended_at: 'ASC' },
          })
        : await this.attendanceRepository.find({
            where: { tenant_id: tenantId, broker_id: brokerId, attended_at: Between(startDate, endDate) },
            relations: { booth: true },
            order: { attended_at: 'ASC' },
          });

      const attendanceSummary = {
        total: attendanceRecords.length,
        vezCount: attendanceRecords.filter((r) => r.tipo === 'vez').length,
        simplesCount: attendanceRecords.filter((r) => r.tipo === 'simples').length,
      };

      const attendances = attendanceRecords.map((r) => ({
        id: r.id,
        brokerId: r.broker_id,
        boothId: r.booth_id,
        boothName: r.booth?.name || 'Plantão removido',
        tipo: r.tipo,
        inSequence: r.in_sequence,
        attendedAt: r.attended_at,
        attendedByUserId: r.attended_by_user_id,
      }));

      const totalCheckIns = isReceptionSelf ? attendanceRecords.length : presences.length;
      const foraJanelaCount = presences.filter((p) => p.roleta_entry_type === 'fora_janela').length;
      const completedCount = isReceptionSelf ? attendanceSummary.vezCount : presences.filter((p) => p.status === 'completed').length;
      const invalidatedCount = isReceptionSelf ? attendanceSummary.simplesCount : presences.filter((p) => p.status === 'invalidated').length;
      const onlineCount = isReceptionSelf ? 0 : presences.filter((p) => p.status === 'online').length;
      const pontualCount = isReceptionSelf ? attendanceSummary.vezCount : presences.filter((p) => p.roleta_entry_type === 'pontual').length;
      const posBarraCount = isReceptionSelf ? attendanceSummary.simplesCount : presences.filter((p) => p.roleta_entry_type === 'pos_barra').length;
      const totalMinutes = isReceptionSelf
        ? 0
        : presences
            .filter((p) => p.status !== 'invalidated')
            .reduce((acc, p) => acc + this.getEffectiveMinutes(p, now), 0);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const punctualityRate = isReceptionSelf ? 0 : totalCheckIns > 0 ? Math.round((pontualCount / totalCheckIns) * 100) : 100;
      const validationRate = isReceptionSelf ? 0 : completedCount + invalidatedCount > 0
        ? Math.round((completedCount / (completedCount + invalidatedCount)) * 100)
        : 100;
      const activeDays = new Set(
        isReceptionSelf
          ? attendanceRecords.map((r) => this.formatDateBR(r.attended_at))
          : presences.map((p) => this.formatDateBR(p.check_in_at)),
      ).size;

      const dayGroups = new Map<string, any[]>();
      const pushEntry = (day: string, entry: any) => {
        const list = dayGroups.get(day) || [];
        list.push(entry);
        dayGroups.set(day, list);
      };

      if (isReceptionSelf) {
        for (const r of attendanceRecords) {
          pushEntry(this.formatDateBR(r.attended_at), {
            id: `att_${r.id}`,
            boothId: r.booth_id,
            boothName: r.booth?.name || 'Plantão removido',
            checkInAt: r.attended_at,
            checkOutAt: null,
            lastConfirmedAt: null,
            accumulatedMinutes: 0,
            hoursFormatted: '0h 0m',
            roletaName: r.tipo === 'vez' ? 'Atendimento vez' : 'Atendimento',
            roletaEntryType: r.tipo,
            roletaPosition: null,
            status: 'attended',
            attendedByUserId: r.attended_by_user_id,
            tipoAtendimento: r.tipo,
          });
        }
      } else {
        for (const p of presences) {
          const day = this.formatDateBR(p.check_in_at);
          const pMinutes = this.getEffectiveMinutes(p, now);
          const pHours = Math.floor(pMinutes / 60);
          const pMin = pMinutes % 60;
          pushEntry(day, {
            id: p.id,
            boothId: p.booth_id,
            boothName: boothMap.get(p.booth_id) || 'Plantão removido',
            checkInAt: p.check_in_at,
            checkOutAt: p.check_out_at,
            lastConfirmedAt: p.last_confirmed_at,
            accumulatedMinutes: p.status === 'invalidated' ? 0 : pMinutes,
            hoursFormatted: p.status === 'invalidated' ? '0h 0m' : `${pHours}h ${pMin}m`,
            roletaName: p.roleta_name || '—',
            roletaEntryType: p.roleta_entry_type || '—',
            roletaPosition: p.roleta_position ?? null,
            status: p.status,
            attendedByUserId: p.attended_by_user_id || null,
            tipoAtendimento: null,
            foraDaJanela: (p.roleta_entry_type as string) === 'fora_janela',
          });
        }
      }

      return {
        broker: brokerInfo,
        period: periodInfo,
        summary: {
          totalCheckIns,
          completedCount,
          invalidatedCount,
          onlineCount,
          pontualCount,
          posBarraCount,
          foraJanelaCount,
          totalMinutes,
          totalHoursFormatted: `${hours}h ${minutes}m`,
          punctualityRate,
          validationRate,
          activeDays,
        },
        attendanceSummary,
        attendances,
        days: Array.from(dayGroups.entries())
          .map(([date, entries]) => ({ date, entries }))
          .sort((a, b) => (a.date < b.date ? -1 : 1)),
      };
    }

    // ===== FLUXO LEGADO =====
    const totalCheckIns = presences.length;
    const completedCount = presences.filter((p) => p.status === 'completed').length;
    const invalidatedCount = presences.filter((p) => p.status === 'invalidated').length;
    const onlineCount = presences.filter((p) => p.status === 'online').length;
    const pontualCount = presences.filter((p) => p.roleta_entry_type === 'pontual').length;
    const posBarraCount = presences.filter((p) => p.roleta_entry_type === 'pos_barra').length;
    const totalMinutes = presences
      .filter((p) => p.status !== 'invalidated')
      .reduce((acc, p) => acc + this.getEffectiveMinutes(p, now), 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const punctualityRate = totalCheckIns > 0 ? Math.round((pontualCount / totalCheckIns) * 100) : 100;
    const validationRate = completedCount + invalidatedCount > 0
      ? Math.round((completedCount / (completedCount + invalidatedCount)) * 100)
      : 100;
    const activeDays = new Set(presences.map((p) => this.formatDateBR(p.check_in_at))).size;

    const legacyDayGroups = new Map<string, any[]>();
    for (const p of presences) {
      const day = this.formatDateBR(p.check_in_at);
      const pMinutes = this.getEffectiveMinutes(p, now);
      const pHours = Math.floor(pMinutes / 60);
      const pMin = pMinutes % 60;
      const list = legacyDayGroups.get(day) || [];
      list.push({
        id: p.id,
        boothId: p.booth_id,
        boothName: boothMap.get(p.booth_id) || 'Plantão removido',
        checkInAt: p.check_in_at,
        checkOutAt: p.check_out_at,
        lastConfirmedAt: p.last_confirmed_at,
        accumulatedMinutes: p.status === 'invalidated' ? 0 : pMinutes,
        hoursFormatted: p.status === 'invalidated' ? '0h 0m' : `${pHours}h ${pMin}m`,
        roletaName: p.roleta_name || '—',
        roletaEntryType: p.roleta_entry_type || '—',
        roletaPosition: p.roleta_position ?? null,
        status: p.status,
        attendedByUserId: p.attended_by_user_id || null,
      });
      legacyDayGroups.set(day, list);
    }

    return {
      broker: brokerInfo,
      period: periodInfo,
      summary: {
        totalCheckIns,
        completedCount,
        invalidatedCount,
        onlineCount,
        pontualCount,
        posBarraCount,
        totalMinutes,
        totalHoursFormatted: `${hours}h ${minutes}m`,
        punctualityRate,
        validationRate,
        activeDays,
      },
      days: Array.from(legacyDayGroups.entries())
        .map(([date, entries]) => ({ date, entries }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  }

  private formatDateBR(d: Date): string {
    if (!d) return '—';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 12. Algoritmo de Score de Plantão: Retorna o mapa de calor de demanda por dia e hora [6]
  async getBoothDemandHeatmap(boothId: string, tenantId: string) {
    // Executa uma agregação avançada de banco de dados extraindo Dia da Semana e Hora de Entrada
    const demandData = await this.presenceRepository.createQueryBuilder('presence')
      .select('EXTRACT(DOW FROM presence.check_in_at)', 'day_of_week') // 0 = Domingo, 1 = Segunda, etc.
      .addSelect('EXTRACT(HOUR FROM presence.check_in_at)', 'hour') // Faixa de horário de 0h a 23h
      .addSelect('COUNT(presence.id)', 'check_in_count') // Quantidade de check-ins ocorridos
      .where('presence.booth_id = :boothId', { boothId })
      .andWhere('presence.tenant_id = :tenantId', { tenantId })
      .groupBy('day_of_week')
      .addGroupBy('hour')
      .orderBy('day_of_week', 'ASC')
      .addOrderBy('hour', 'ASC')
      .getRawMany();

    // Mapeia e higieniza os dados numéricos do Postgres para o formato JSON correto
    const heatmap = demandData.map((row) => ({
      dayOfWeek: parseInt(row.day_of_week, 10),
      hour: parseInt(row.hour, 10),
      checkInCount: parseInt(row.check_in_count, 10),
    }));

    return {
      boothId,
      message: 'Mapa de calor de demanda histórica do plantão carregado com sucesso.',
      heatmap,
    };
  }

  async forceCheckIn(
    actor: { sub: string; role: string },
    tenantId: string,
    dto: { brokerId?: string; boothId?: string } = {},
  ) {
    if (!['diretoria_level_1', 'gerencia_level_2', 'recepcao_level_3', 'platform_admin_level_0'].includes(actor.role)) {
      throw new ForbiddenException('Ação restrita à Diretoria, Gerência, Recepção ou Admin da plataforma.');
    }

    const targetBrokerId = dto.brokerId || actor.sub;

    const broker = await this.presenceRepository.manager.getRepository(User).findOne({ where: { id: targetBrokerId, tenant_id: tenantId } });
    if (!broker || broker.removed_at) throw new NotFoundException('Corretor não localizado no sistema.');
    if (broker.role !== 'corretor_level_3') {
      throw new BadRequestException('O check-in forçado só pode ser aplicado a um corretor.');
    }
    if (broker.stage_expires_at && new Date(broker.stage_expires_at) <= new Date()) {
      throw new BadRequestException(`Check-in bloqueado. O estágio de '${broker.broker_stage || 'treinamento'}' do corretor expirou. Solicite a renovação ou promoção junto à Diretoria.`);
    }
    if (broker.status === 'inactive') {
      throw new BadRequestException('Check-in bloqueado. O cadastro do corretor está inativo ou suspenso.');
    }

    const alreadyActive = await this.presenceRepository.findOne({
      where: { broker_id: targetBrokerId, tenant_id: tenantId, status: 'online' },
    });
    if (alreadyActive) {
      throw new BadRequestException(`O corretor '${broker.nome_guerra}' já possui um check-in ativo. Finalize o turno atual antes de iniciar outro.`);
    }

    let booth: Booth | null = null;
    if (dto.boothId) {
      booth = await this.boothRepository.findOne({ where: { id: dto.boothId, tenant_id: tenantId } });
    }
    if (!booth && actor.role === 'recepcao_level_3') {
      const assignments = await this.receptionistRepository.find({
        where: { receptionist_id: actor.sub, tenant_id: tenantId, is_active: true },
      });
      if (assignments.length === 1) {
        booth = await this.boothRepository.findOne({ where: { id: assignments[0].booth_id, tenant_id: tenantId } });
      }
    }
    if (!booth && actor.role !== 'recepcao_level_3') {
      booth = await this.boothRepository.findOne({
        where: { tenant_id: tenantId, lifecycle_status: 'published' },
        order: { name: 'ASC' },
      });
    }
    if (!booth) {
      if (actor.role === 'recepcao_level_3') {
        throw new BadRequestException('Informe o plantão. A recepção só pode operar nos plantões que lhe foram atribuídos.');
      }
      throw new NotFoundException('Nenhum plantão publicado encontrado para check-in.');
    }
    if (booth.lifecycle_status !== 'published') {
      throw new BadRequestException('Check-in não permitido. O plantão de vendas não está publicado para atendimento.');
    }

    await this.assertCanOperateBooth(actor, tenantId, booth.id);

    // Respeita fielmente a janela da roleta do momento (mesma lógica do check-in normal)
    const { ruleSet, matchingRoleta, roletaTimes, earlyMinutes, posBarraMinutes } = await this.resolveRoletaForBooth(booth);

    // Estágio permitido nas regras vigentes do plantão.
    const allowedStages: string[] = (ruleSet as any).allowed_broker_stages ?? ALL_BROKER_STAGES;
    const stageAllowed =
      Array.isArray(allowedStages) &&
      allowedStages.length > 0 &&
      allowedStages.includes(broker.broker_stage || 'corretor_creci');

    // NOVA IDENTIDADE: o check-in manual da Recepção também respeita o novo fluxo — fora da janela
    // de validade ou com estágio não liberado, registra presença "fora da janela" (sem validação).
    // Legado: o check-in manual rejeita fora da janela/estágio (exceto reaproveitando a roleta de
    // outra presença ativa no plantão, comportando-se como "pós-barra").
    const novaIdentidade = await this.isNovaIdentidade(tenantId);
    const isOutOfWindow = !matchingRoleta || !stageAllowed;

    const now = new Date();
    let assignedEntryType: 'pontual' | 'pos_barra' | 'fora_janela' = 'fora_janela';
    let assignedRoletaName: string | null = matchingRoleta?.name || null;
    let roletaAnchor: Date | null = null;
    let assignedPosition: number | null = null;

    if (novaIdentidade) {
      if (isOutOfWindow) {
        assignedEntryType = 'fora_janela';
        assignedRoletaName = matchingRoleta?.name || null;
        roletaAnchor = null; // Sem âncora de validação → sempre finaliza invalidado
      } else {
        const tzNowForRoleta = getNowInTimezone('America/Sao_Paulo');
        roletaAnchor = getDateAtTimeInTimezone(
          tzNowForRoleta.dateStr,
          minutesToTimeString(matchingRoleta!.roletaMinutes),
        );

        if (matchingRoleta!.isPontual) {
          assignedEntryType = 'pontual';
          assignedPosition = null; // Aguarda o sorteio automático
        } else {
          assignedEntryType = 'pos_barra';
          // Pós-Barra entra no final da fila, contando também os pontuais ainda sem posição.
          const existingInBooth = await this.presenceRepository.find({
            where: { booth_id: booth.id, tenant_id: tenantId, status: 'online', roleta_name: assignedRoletaName! },
          });
          const positionedCount = existingInBooth.filter((p) => p.roleta_position !== null).length;
          const unplacedPontualCount = existingInBooth.filter(
            (p) => p.roleta_position === null && p.roleta_entry_type === 'pontual',
          ).length;
          assignedPosition = positionedCount + unplacedPontualCount + 1;
        }
      }
    } else {
      // ===== COMPORTAMENTO LEGADO (flag de nova identidade desligado) =====
      if (!Array.isArray(allowedStages) || allowedStages.length === 0) {
        throw new BadRequestException(
          `Check-in bloqueado. O plantão '${booth.name}' não está liberado para nenhum estágio neste momento. Contate a Diretoria.`,
        );
      }
      if (!stageAllowed) {
        throw new BadRequestException(
          `Check-in bloqueado. O plantão '${booth.name}' não está liberado para corretores em fase '${broker.broker_stage || 'treinamento'}'. Fases liberadas: ${allowedStages.join(', ')}.`,
        );
      }

      let roletaName = matchingRoleta?.name || null;
      if (!roletaName) {
        // Sem roleta aberta, tenta reutilizar a roleta de outra presença ativa no plantão.
        const activeInBooth = await this.presenceRepository.find({
          where: { booth_id: booth.id, tenant_id: tenantId, status: 'online', attended_at: IsNull() },
        });
        if (activeInBooth.length === 0) {
          const allowedWindows = roletaTimes.map((r) => {
            const roletaMin = timeStringToMinutes(r.time);
            const earlyStr = minutesToTimeString(roletaMin - earlyMinutes);
            const drawStr = minutesToTimeString(roletaMin + 1);
            const endStr = minutesToTimeString(roletaMin + posBarraMinutes);
            return `${r.name} (Check-in das ${earlyStr} às ${endStr} · Sorteio às ${drawStr})`;
          }).join(' | ');
          throw new BadRequestException(
            `Check-in fora do horário permitido para o plantão '${booth.name}'. Janelas de Check-in hoje: ${allowedWindows}.`,
          );
        }

        // Roleta mais comum entre as presenças ativas (fallback do nome da roleta).
        const roletaCounts = new Map<string, number>();
        let mostActiveName: string | null = null;
        let mostActiveCount = 0;
        for (const p of activeInBooth) {
          if (!p.roleta_name) continue;
          const count = (roletaCounts.get(p.roleta_name) || 0) + 1;
          roletaCounts.set(p.roleta_name, count);
          if (count > mostActiveCount) {
            mostActiveCount = count;
            mostActiveName = p.roleta_name;
          }
        }
        if (!mostActiveName) {
          throw new BadRequestException(
            `Check-in fora do horário permitido para o plantão '${booth.name}'. Janelas de Check-in hoje: ${roletaTimes.map((r) => {
              const roletaMin = timeStringToMinutes(r.time);
              return `${r.name} (das ${minutesToTimeString(roletaMin - earlyMinutes)} às ${minutesToTimeString(roletaMin + posBarraMinutes)})`;
            }).join(' | ')}.`,
          );
        }
        roletaName = mostActiveName;
      }

      assignedRoletaName = roletaName;
      const tzNowForRoleta = getNowInTimezone('America/Sao_Paulo');
      roletaAnchor = matchingRoleta
        ? getDateAtTimeInTimezone(tzNowForRoleta.dateStr, minutesToTimeString(matchingRoleta.roletaMinutes))
        : now;

      if (matchingRoleta?.isPontual) {
        assignedEntryType = 'pontual';
        assignedPosition = null; // Aguarda o sorteio automático
      } else {
        assignedEntryType = 'pos_barra';
        // Entra no final da fila, contando também os pontuais ainda sem posição.
        const existingInBooth = await this.presenceRepository.find({
          where: { booth_id: booth.id, tenant_id: tenantId, status: 'online', roleta_name: roletaName },
        });
        const positionedCount = existingInBooth.filter((p) => p.roleta_position !== null).length;
        const unplacedPontualCount = existingInBooth.filter(
          (p) => p.roleta_position === null && p.roleta_entry_type === 'pontual',
        ).length;
        assignedPosition = positionedCount + unplacedPontualCount + 1;
      }
    }

    const presence = this.presenceRepository.create({
      tenant_id: tenantId,
      broker_id: broker.id,
      booth_id: booth.id,
      rule_set_id: ruleSet.id || null,
      minimum_period_minutes: ruleSet.minimum_period_minutes,
      period_weight: ruleSet.period_weight,
      minimum_monthly_periods: ruleSet.minimum_monthly_periods,
      roleta_name: assignedRoletaName,
      roleta_entry_type: assignedEntryType,
      roleta_position: assignedPosition,
      validation_starts_at: roletaAnchor,
      check_in_at: now,
      last_confirmed_at: now,
      next_confirmation_at: this.getNextConfirmationAt(now, ruleSet.ping_interval_minutes),
      status: 'online',
    });

    const saved = await this.presenceRepository.save(presence);
    void this.userRepository.update({ id: broker.id }, { last_checkin_at: now });
    this.realtimeService.publish({
      eventType: 'presence.checked_in',
      tenantId,
      aggregateId: saved.id,
      payload: {
        brokerId: broker.id,
        boothId: booth.id,
        status: saved.status,
        roletaPosition: saved.roleta_position,
        roletaEntryType: saved.roleta_entry_type,
        drawTimeFormatted: matchingRoleta ? matchingRoleta.drawTimeFormatted : null,
        nextConfirmationAt: saved.next_confirmation_at,
      },
    });
    void this.notificationsService.sendToUser(
      broker.id,
      tenantId,
      'Check-in registrado pela recepção',
      saved.roleta_entry_type === 'fora_janela'
        ? `Você está ativo no plantão '${booth.name}' FORA da janela de validade. Você pode ser atendido, mas este período não será validado.`
        : `Você está ativo no plantão '${booth.name}' na ${saved.roleta_name || 'roleta do momento'}. Sorteio às ${matchingRoleta ? matchingRoleta.drawTimeFormatted : '—'}.`,
      { type: 'force_checkin', presenceId: saved.id, boothId: booth.id },
    );
    void this.processRoletaDraws();

    return {
      message: saved.roleta_entry_type === 'fora_janela'
        ? `Check-in registrado para '${broker.nome_guerra}' FORA da janela de validade (sem validação de período). Convóquem pelo botão de atendimento.`
        : assignedEntryType === 'pos_barra'
        ? `Check-in registrado para '${broker.nome_guerra}'. Pós-Barra: ${assignedPosition}º Lugar no final da fila.`
        : `Check-in registrado para '${broker.nome_guerra}' na ${saved.roleta_name || 'roleta do momento'}. Sorteio às ${matchingRoleta ? matchingRoleta.drawTimeFormatted : '—'}.`,
      presence: {
        id: saved.id,
        boothId: booth.id,
        boothName: booth.name,
        brokerId: broker.id,
        brokerName: broker.nome_guerra,
        status: saved.status,
        roletaPosition: saved.roleta_position,
        roletaName: saved.roleta_name,
        roletaEntryType: saved.roleta_entry_type,
        checkInAt: saved.check_in_at,
        drawTimeFormatted: matchingRoleta ? matchingRoleta.drawTimeFormatted : null,
        outOfWindow: saved.roleta_entry_type === 'fora_janela',
      },
    };
  }

  // Revalidação da presença suspensa pela Recepção (hierarquia 0): mantém a posição original da roleta
  async forceValidate(actor: { sub: string; role: string }, tenantId: string, dto: { presenceId?: string }) {
    if (!dto.presenceId) throw new BadRequestException('Informe a presença a revalidar.');
    const presence = await this.presenceRepository.findOne({ where: { id: dto.presenceId, tenant_id: tenantId } });
    if (!presence) throw new NotFoundException('Presença não localizada.');

    await this.assertCanOperateBooth(actor, tenantId, presence.booth_id);

    if (presence.status !== 'absent') {
      throw new BadRequestException('A presença só pode ser revalidada quando estiver suspensa por ausência.');
    }

    const pendingPing = await this.logRepository.findOne({
      where: { presence_id: presence.id, response_status: 'pending' },
      order: { sent_at: 'DESC' },
    });
    if (pendingPing) {
      pendingPing.response_status = 'valid_reception';
      pendingPing.responded_at = new Date();
      pendingPing.latitude = null;
      pendingPing.longitude = null;
      await this.logRepository.save(pendingPing);
    }

    const now = new Date();
    const booth = await this.boothRepository.findOne({ where: { id: presence.booth_id, tenant_id: tenantId } });
    const ruleSet = booth ? await this.getRuleSetForBooth(booth) : undefined;
    presence.status = 'online';
    presence.last_confirmed_at = now;
    presence.next_confirmation_at = this.getNextConfirmationAt(now, Number(ruleSet?.ping_interval_minutes ?? 30));
    await this.presenceRepository.save(presence);

    this.realtimeService.publish({
      eventType: 'presence.revalidated',
      tenantId,
      aggregateId: presence.id,
      payload: { brokerId: presence.broker_id, boothId: presence.booth_id, status: presence.status, roletaPosition: presence.roleta_position },
    });
    void this.notificationsService.sendToUser(
      presence.broker_id,
      tenantId,
      'Presença revalidada pela recepção',
      'Sua ausência foi revalidada pela recepção. Sua posição na fila foi mantida e o turno segue ativo.',
      { type: 'presence_revalidated', presenceId: presence.id },
    );

    return {
      message: 'Presença revalidada pela recepção. A posição do corretor na fila foi mantida.',
      status: 'online',
      roletaPosition: presence.roleta_position,
    };
  }

  // Atendimento SIMPLES (novo fluxo): a Recepção convoca QUALQUER corretor da fila (inclusive os
  // "fora da janela") com Aviso + Registro, mas SEM rotação — o corretor permanece na mesma posição.
  async attendPresence(actor: { sub: string; role: string }, tenantId: string, presenceId: string) {
    const presence = await this.presenceRepository.findOne({
      where: { id: presenceId, tenant_id: tenantId },
      relations: { broker: true },
    });
    if (!presence) throw new NotFoundException('Presença não localizada.');

    const booth = await this.boothRepository.findOne({ where: { id: presence.booth_id, tenant_id: tenantId } });
    if (!booth) throw new NotFoundException('Plantão não localizado.');

    await this.assertCanOperateBooth(actor, tenantId, booth.id);

    if (presence.status !== 'online') {
      throw new BadRequestException('Só é possível convocar corretores com presença online no plantão.');
    }

    // Nova identidade: convocação avulsa (Fora a vez — paciência: o fluxo novo registra o
    // atendimento sem remover o corretor da fila). Legado: registra atendido e REMOVE da fila.
    if (!(await this.isNovaIdentidade(tenantId))) {
      if (presence.attended_at) {
        return {
          message: `O corretor '${presence.broker?.nome_guerra || ''}' já foi atendido nesta roleta.`,
          servedAt: presence.attended_at,
          alreadyServed: true,
        };
      }

      presence.attended_at = new Date();
      presence.attended_by_user_id = actor.sub;
      await this.presenceRepository.save(presence);

      this.realtimeService.publish({
        eventType: 'presence.served',
        tenantId,
        aggregateId: presence.id,
        payload: {
          presenceId: presence.id,
          brokerId: presence.broker_id,
          boothId: presence.booth_id,
          attendedAt: presence.attended_at,
          attendedBy: actor.sub,
        },
      });

      return {
        message: `Corretor '${presence.broker?.nome_guerra || ''}' atendido. O próximo da fila foi convocado.`,
        servedAt: presence.attended_at,
      };
    }

    // Atualiza a última confirmação do ping pendente (o corretor está presente no plantão)
    const pendingPing = await this.logRepository.findOne({
      where: { presence_id: presence.id, response_status: 'pending' },
      order: { sent_at: 'DESC' },
    });
    if (pendingPing) {
      pendingPing.response_status = 'valid_reception';
      pendingPing.responded_at = new Date();
      pendingPing.latitude = null;
      pendingPing.longitude = null;
      await this.logRepository.save(pendingPing);
    }

    const message = `Convocação de atendimento no plantão '${booth.name}': o cliente está pronto para você, ${presence.broker?.nome_guerra || ''}.`;
    const record = await this.recordAttendance(tenantId, {
      presenceId: presence.id,
      brokerId: presence.broker_id,
      booth,
      atorId: actor.sub,
      tipo: 'simples',
      inSequence: presence.roleta_entry_type !== 'fora_janela',
      message,
    });

    void this.notificationsService.sendToUser(
      presence.broker_id,
      tenantId,
      'Convocação de atendimento',
      message,
      { type: 'attendance_called', presenceId: presence.id, attendanceId: record.id },
    );

    return {
      message: `Aviso enviado para '${presence.broker?.nome_guerra || ''}'. Atendimento registrado (a posição na fila foi mantida).`,
      attendanceId: record.id,
      tipo: 'simples',
      inSequence: presence.roleta_entry_type !== 'fora_janela',
    };
  }

  // Atendimento VEZ: somente para o PRIMEIRO corretor da sequência da roleta. Após atender,
  // ele retorna ao FINAL da fila (rotação) e segue online até encerrar o período/check-out.
  async attendVez(actor: { sub: string; role: string }, tenantId: string, presenceId: string) {
    if (!(await this.isNovaIdentidade(tenantId))) {
      throw new ForbiddenException('O atendimento "vez" é exclusivo da nova identidade.');
    }

    const presence = await this.presenceRepository.findOne({
      where: { id: presenceId, tenant_id: tenantId },
      relations: { broker: true },
    });
    if (!presence) throw new NotFoundException('Presença não localizada.');

    const booth = await this.boothRepository.findOne({ where: { id: presence.booth_id, tenant_id: tenantId } });
    if (!booth) throw new NotFoundException('Plantão não localizado.');

    await this.assertCanOperateBooth(actor, tenantId, booth.id);

    if (presence.status !== 'online') {
      throw new BadRequestException('Só é possível atender a vez de corretores com presença online.');
    }
    if (presence.roleta_entry_type === 'fora_janela' || !presence.roleta_name) {
      throw new BadRequestException('Este corretor está fora da sequência da roleta. Use o botão "Atendimento" para convocá-lo.');
    }

    const queue = await this.getEffectiveQueue(presence.booth_id, tenantId, presence.roleta_name, true);
    const first = queue[0];
    if (!first || first.presenceId !== presenceId) {
      const primeiroNome = first?.nomeGuerra || '—';
      throw new BadRequestException(
        `A vez da fila é de '${primeiroNome}'. Use "Atendimento" para convocar os demais corretores.`,
      );
    }

    presence.vez_rotations = (presence.vez_rotations ?? 0) + 1;
    presence.last_vez_at = new Date();
    await this.presenceRepository.save(presence);

    const message = `Sua vez de atender no plantão '${booth.name}'! Após este atendimento você retornou ao final da fila.`;
    const record = await this.recordAttendance(tenantId, {
      presenceId: presence.id,
      brokerId: presence.broker_id,
      booth,
      atorId: actor.sub,
      tipo: 'vez',
      inSequence: true,
      message,
    });

    void this.notificationsService.sendToUser(
      presence.broker_id,
      tenantId,
      'Sua vez na fila de atendimento',
      message,
      { type: 'attendance_vez', presenceId: presence.id, attendanceId: record.id },
    );

    return {
      message: `'${presence.broker?.nome_guerra || ''}' atendeu a vez e retornou ao final da fila.`,
      attendanceId: record.id,
      tipo: 'vez',
      vezRotations: presence.vez_rotations,
    };
  }

  // Listagem de TODOS os atendimentos (para análise posterior): Diretoria/RH/Recepção veem todos
  // dentro do período; o próprio corretor vê apenas os dele.
  async listAttendances(
    actor: { sub: string; role: string },
    tenantId: string,
    filters: { startDate?: string; endDate?: string; boothId?: string; brokerId?: string } = {},
  ) {
    if (!(await this.isNovaIdentidade(tenantId))) {
      throw new ForbiddenException('A listagem de atendimentos é exclusiva da nova identidade.');
    }

    const canViewAll = ['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1', 'recepcao_level_3'].includes(actor.role);
    if (!canViewAll && actor.role !== 'corretor_level_3') {
      throw new ForbiddenException('Acesso restrito aos registros de atendimento.');
    }

    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const [curYear, curMonth] = tzNow.dateStr.split('-').map(Number);
    const startDate = filters.startDate
      ? getDateAtTimeInTimezone(filters.startDate, '00:00')
      : getDateAtTimeInTimezone(`${curYear}-${String(curMonth).padStart(2, '0')}-01`, '00:00');
    const endDate = filters.endDate
      ? new Date(getDateAtTimeInTimezone(filters.endDate, '00:00').getTime() + 24 * 60 * 60 * 1000 - 1)
      : new Date(getDateAtTimeInTimezone(tzNow.dateStr, '00:00').getTime() + 24 * 60 * 60 * 1000 - 1);

    const rangeDays = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (rangeDays > 93) {
      throw new BadRequestException('O período máximo para consulta dos atendimentos é de 3 meses.');
    }

    const where: any = { tenant_id: tenantId, attended_at: Between(startDate, endDate) };
    if (filters.boothId) where.booth_id = filters.boothId;
    if (filters.brokerId || (actor.role === 'corretor_level_3' && !canViewAll)) {
      where.broker_id = filters.brokerId || actor.sub;
    } else if (actor.role === 'corretor_level_3') {
      where.broker_id = actor.sub;
    }

    const records = await this.attendanceRepository.find({
      where,
      relations: { broker: true, booth: true },
      order: { attended_at: 'DESC' },
      take: 500,
    });

    const userIds = Array.from(new Set(records.map((r) => r.attended_by_user_id)));
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds), tenant_id: tenantId } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.nome_guerra || u.name]));

    return {
      total: records.length,
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      attendances: records.map((r) => ({
        id: r.id,
        brokerId: r.broker_id,
        brokerName: r.broker?.nome_guerra || 'Corretor',
        boothId: r.booth_id,
        boothName: r.booth?.name || 'Plantão removido',
        tipo: r.tipo,
        inSequence: r.in_sequence,
        attendedAt: r.attended_at,
        attendedByUserId: r.attended_by_user_id,
        attendedByName: userMap.get(r.attended_by_user_id) || 'Recepção',
      })),
    };
  }

  // Fila unificada e recalculada: desconsidera corretores já atendidos e recalcula a posição efetiva.
  // rotationOrder (nova identidade): ordena primeiro por vez_rotations (quem atendeu menos na
  // frente); legado mantém a ordenação original por posição da roleta/horário de check-in.
  private async getEffectiveQueue(boothId: string, tenantId: string, roletaName: string, rotationOrder = false) {
    const queuePresences = await this.presenceRepository.find({
      where: {
        booth_id: boothId,
        tenant_id: tenantId,
        status: 'online',
        roleta_name: roletaName,
        attended_at: IsNull(),
      },
      relations: { broker: true },
    });

    const sortedQueue = queuePresences.sort((a, b) => {
      if (rotationOrder) {
        const aRot = a.vez_rotations ?? 0;
        const bRot = b.vez_rotations ?? 0;
        if (aRot !== bRot) return aRot - bRot;
      }
      const aPos = a.roleta_position ?? Number.MAX_SAFE_INTEGER;
      const bPos = b.roleta_position ?? Number.MAX_SAFE_INTEGER;
      if (aPos === bPos) {
        return new Date(a.check_in_at).getTime() - new Date(b.check_in_at).getTime();
      }
      return aPos - bPos;
    });
    const positioned = sortedQueue.filter((p) => p.roleta_position !== null);
    const notPositioned = sortedQueue.filter((p) => p.roleta_position === null);

    return [...positioned, ...notPositioned].map((p, index) => ({
      presenceId: p.id,
      brokerId: p.broker_id,
      nomeGuerra: p.broker?.nome_guerra || 'Corretor',
      roletaPosition: p.roleta_position,
      effectivePosition: index + 1,
      isFirst: index === 0,
      roletaEntryType: p.roleta_entry_type,
      vezRotations: p.vez_rotations ?? 0,
      minutesActive: Math.max(0, Math.floor((Date.now() - new Date(p.validation_starts_at || p.check_in_at).getTime()) / 1000 / 60)),
      checkInAt: p.check_in_at,
    }));
  }

  // Fila do plantão para a Recepção: mostra somente a roleta do momento (roleta ativa)
  async getBoothQueue(actor: { sub: string; role: string }, tenantId: string, boothId: string) {
    const booth = await this.boothRepository.findOne({ where: { id: boothId, tenant_id: tenantId } });
    if (!booth) throw new NotFoundException('Plantão de vendas não localizado.');

    await this.assertCanOperateBooth(actor, tenantId, booth.id);

    const emptyQueue = {
      boothId: booth.id,
      boothName: booth.name,
      currentRoleta: null,
      queue: [],
      awaitingRevalidation: [],
    };

    const novaIdentidade = await this.isNovaIdentidade(tenantId);
    const { matchingRoleta } = await this.resolveRoletaForBooth(booth);

    // Corretores online "fora da janela" (check-in livre fora do horário/estágio da roleta):
    // aparecem numa seção à parte para a Recepção atendê-los (Atendimento), mas SEM entrar na
    // sequência oficial. Só é convocado com o botão comum, nunca com "Atendimento vez".
    // Recurso EXCLUSIVO da nova identidade — no legado o check-in fora da janela nem é aceito.
    let outOfWindow: any[] = [];
    if (novaIdentidade) {
      const outOfWindowPresences = await this.presenceRepository.find({
        where: {
          booth_id: booth.id,
          tenant_id: tenantId,
          status: 'online',
          roleta_entry_type: 'fora_janela',
        },
        relations: { broker: true },
        order: { check_in_at: 'ASC' },
      });
      outOfWindow = outOfWindowPresences.map((p) => ({
        presenceId: p.id,
        brokerId: p.broker_id,
        nomeGuerra: p.broker?.nome_guerra || 'Corretor',
        roletaEntryType: p.roleta_entry_type,
        isFirst: false,
        minutesActive: Math.max(0, Math.floor((Date.now() - new Date(p.validation_starts_at || p.check_in_at).getTime()) / 1000 / 60)),
        checkInAt: p.check_in_at,
      }));
    }

    // Fora da janela de check-in/pós-barra não há roleta resolvida, mas corretores que já estão
    // online no plantão AINDA aguardam atendimento. Mantém a sequência de atendimento visível,
    // recuperando a roleta mais frequente entre essas presenças para não "sumir" com os botões.
    let roletaName = matchingRoleta?.name || null;
    let drawTimeFormatted = matchingRoleta?.drawTimeFormatted || null;

    if (!roletaName) {
      const pendingOnline = await this.presenceRepository.find({
        where: { booth_id: booth.id, tenant_id: tenantId, status: 'online', attended_at: IsNull() },
        relations: { broker: true },
      });
      const roletaCounts = new Map<string, number>();
      let maxName: string | null = null;
      let maxCount = 0;
      for (const p of pendingOnline) {
        if (!p.roleta_name) continue;
        const count = (roletaCounts.get(p.roleta_name) || 0) + 1;
        roletaCounts.set(p.roleta_name, count);
        if (count > maxCount) {
          maxCount = count;
          maxName = p.roleta_name;
        }
      }
      roletaName = maxName;
    }

    if (!roletaName) {
      return novaIdentidade ? { ...emptyQueue, outOfWindow } : emptyQueue;
    }

    const queue = await this.getEffectiveQueue(booth.id, tenantId, roletaName, novaIdentidade);

    const awaitingRevalidation = await this.presenceRepository.find({
      where: {
        booth_id: booth.id,
        tenant_id: tenantId,
        status: 'absent',
        roleta_name: roletaName,
      },
      relations: { broker: true },
      order: { check_in_at: 'ASC' },
    });

    return {
      boothId: booth.id,
      boothName: booth.name,
      currentRoleta: {
        name: roletaName,
        drawTimeFormatted,
        phase: matchingRoleta?.isPontual ? 'aguardando_sorteio' : 'apos_sorteio',
      },
      queue,
      ...(novaIdentidade ? { outOfWindow } : {}),
      awaitingRevalidation: awaitingRevalidation.map((p) => ({
        presenceId: p.id,
        brokerId: p.broker_id,
        nomeGuerra: p.broker?.nome_guerra || 'Corretor',
        roletaPosition: p.roleta_position,
        checkInAt: p.check_in_at,
      })),
    };
  }

  // 13. RELATÓRIO EXECUTIVO EM TEMPO REAL: Torre de Controle da Diretoria
  async getRealtimeExecutiveReport(tenantId: string) {
    const booths = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
      order: { name: 'ASC' },
    });

    const now = new Date();
    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const todayStart = getDateAtTimeInTimezone(tzNow.dateStr, '00:00');
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const activePresences = await this.presenceRepository.find({
      where: { tenant_id: tenantId, status: 'online' },
      relations: { broker: true, booth: true },
      order: { roleta_position: 'ASC', check_in_at: 'ASC' },
    });

    const invalidatedPresences = await this.presenceRepository.find({
      where: {
        tenant_id: tenantId,
        status: 'invalidated',
        check_out_at: Between(todayStart, todayEnd),
      },
      relations: { broker: true, booth: true },
      order: { check_out_at: 'ASC', created_at: 'DESC' },
    });

    const todayPresences = await this.presenceRepository.find({
      where: {
        tenant_id: tenantId,
        check_in_at: Between(todayStart, todayEnd),
      },
    });

    const presencesByBooth = new Map<string, typeof activePresences>();
    for (const p of activePresences) {
      const list = presencesByBooth.get(p.booth_id) || [];
      list.push(p);
      presencesByBooth.set(p.booth_id, list);
    }

    const invalidatedByBooth = new Map<string, typeof invalidatedPresences>();
    for (const p of invalidatedPresences) {
      const list = invalidatedByBooth.get(p.booth_id) || [];
      list.push(p);
      invalidatedByBooth.set(p.booth_id, list);
    }

    const boothsReport = await Promise.all(
      booths.map(async (booth) => {
        const ruleSet = await this.getRuleSetForBooth(booth);
        const onlineInBooth = presencesByBooth.get(booth.id) || [];
        const invalidatedInBooth = invalidatedByBooth.get(booth.id) || [];
        const minRequired = ruleSet.minimum_brokers_required ?? 2;
        const isUnderstaffed = onlineInBooth.length < minRequired;

        const onlineBrokers = onlineInBooth.map((p) => {
          const countStart = p.validation_starts_at || p.check_in_at;
          const minutesActive = Math.max(0, Math.floor((now.getTime() - countStart.getTime()) / 1000 / 60));
          return {
            presenceId: p.id,
            brokerId: p.broker_id,
            nomeGuerra: p.broker?.nome_guerra || 'Corretor',
            name: p.broker?.name || 'Corretor',
            brokerStage: p.broker?.broker_stage || 'corretor_creci',
            creci: p.broker?.creci || null,
            roletaPosition: p.roleta_position,
            roletaName: p.roleta_name,
            roletaEntryType: p.roleta_entry_type,
            checkInAt: p.check_in_at,
            minutesActive,
            hoursFormatted: `${Math.floor(minutesActive / 60)}h ${minutesActive % 60}m`,
            lastConfirmedAt: p.last_confirmed_at,
          };
        });

        const invalidatedBrokers = invalidatedInBooth.map((p) => {
          const accumulated = p.accumulated_minutes || 0;
          return {
            presenceId: p.id,
            brokerId: p.broker_id,
            nomeGuerra: p.broker?.nome_guerra || 'Corretor',
            name: p.broker?.name || 'Corretor',
            brokerStage: p.broker?.broker_stage || 'corretor_creci',
            creci: p.broker?.creci || null,
            roletaPosition: p.roleta_position,
            roletaName: p.roleta_name,
            roletaEntryType: p.roleta_entry_type,
            checkInAt: p.check_in_at,
            invalidatedAt: p.check_out_at || null,
            minutesActive: accumulated,
            hoursFormatted: `${Math.floor(accumulated / 60)}h ${accumulated % 60}m`,
            lastConfirmedAt: p.last_confirmed_at,
          };
        });

        return {
          boothId: booth.id,
          boothName: booth.name,
          address: booth.address,
          onlineCount: onlineInBooth.length,
          invalidatedCount: invalidatedInBooth.length,
          minRequired,
          isUnderstaffed,
          hasBrokers: onlineInBooth.length > 0,
          onlineBrokers,
          invalidatedBrokers,
        };
      }),
    );

    const activeBoothsCount = boothsReport.filter((b) => b.hasBrokers).length;
    const emptyBoothsCount = boothsReport.filter((b) => !b.hasBrokers).length;
    const understaffedBoothsCount = boothsReport.filter((b) => b.isUnderstaffed).length;
    const countableTodayPresences = todayPresences.filter((p) => p.status !== 'invalidated');
    const totalTodayMinutes = countableTodayPresences.reduce(
      (acc, p) => acc + this.getEffectiveMinutes(p, now),
      0,
    );

    return {
      updatedAt: now.toISOString(),
      totalBooths: booths.length,
      activeBoothsCount,
      emptyBoothsCount,
      understaffedBoothsCount,
      onlineBrokersCount: activePresences.length,
      invalidatedBrokersCount: invalidatedPresences.length,
      todayCheckinsCount: todayPresences.length,
      todayTotalHoursFormatted: `${Math.floor(totalTodayMinutes / 60)}h ${totalTodayMinutes % 60}m`,
      booths: boothsReport,
    };
  }

  // 14. RELATÓRIO DE CORRETORES: Produtividade, Horas e Assiduidade
  async getBrokersExecutiveReport(
    tenantId: string,
    startDateStr?: string,
    endDateStr?: string,
    boothId?: string,
    managerId?: string,
  ) {
    const now = new Date();
    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const [curYear, curMonth] = tzNow.dateStr.split('-').map(Number);
    const startDate = startDateStr
      ? getDateAtTimeInTimezone(startDateStr, '00:00')
      : getDateAtTimeInTimezone(
          `${curYear}-${String(curMonth).padStart(2, '0')}-01`,
          '00:00',
        );
    const endDate = endDateStr
      ? new Date(
          getDateAtTimeInTimezone(endDateStr, '00:00').getTime() +
            24 * 60 * 60 * 1000 -
            1,
        )
      : new Date(
          getDateAtTimeInTimezone(tzNow.dateStr, '00:00').getTime() +
            24 * 60 * 60 * 1000 -
            1,
        );

    const userRepo = this.presenceRepository.manager.getRepository(User);
    const whereBrokers: any = {
      tenant_id: tenantId,
      role: 'corretor_level_3',
      removed_at: IsNull(),
    };
    if (managerId) {
      whereBrokers.manager_id = managerId;
    }

    const brokers = await userRepo.find({
      where: whereBrokers,
      order: { name: 'ASC' },
    });

    const managers = await userRepo.find({
      where: { tenant_id: tenantId, role: 'gerencia_level_2', removed_at: IsNull() },
    });
    const managerMap = new Map(managers.map((m) => [m.id, m.nome_guerra || m.name]));

    const presencesQuery = this.presenceRepository.createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.check_in_at BETWEEN :start AND :end', { start: startDate, end: endDate });

    if (boothId) {
      presencesQuery.andWhere('p.booth_id = :boothId', { boothId });
    }

    const presences = await presencesQuery.getMany();

    const presencesByBroker = new Map<string, Presence[]>();
    for (const p of presences) {
      const list = presencesByBroker.get(p.broker_id) || [];
      list.push(p);
      presencesByBroker.set(p.broker_id, list);
    }

    // Pré-carrega booths e ruleSets fora do loop para evitar N×M queries ao banco
    const boothsForEligibility = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
      order: { name: 'ASC' },
    });
    const boothRuleSetsForReport = new Map<string, BoothRuleSet>();
    for (const booth of boothsForEligibility) {
      boothRuleSetsForReport.set(booth.id, await this.getRuleSetForBooth(booth));
    }

    const report = await Promise.all(
      brokers.map(async (broker) => {
        const brokerPresences = presencesByBroker.get(broker.id) || [];
        const totalCheckIns = brokerPresences.length;
        const completedCount = brokerPresences.filter((p) => p.status === 'completed').length;
        const invalidatedCount = brokerPresences.filter((p) => p.status === 'invalidated').length;
        const onlineCount = brokerPresences.filter((p) => p.status === 'online').length;
        const pontualCount = brokerPresences.filter((p) => p.roleta_entry_type === 'pontual').length;
        const posBarraCount = brokerPresences.filter((p) => p.roleta_entry_type === 'pos_barra').length;
        const totalMinutes = brokerPresences
          .filter((p) => p.status !== 'invalidated')
          .reduce((acc, p) => acc + this.getEffectiveMinutes(p, now), 0);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const punctualityRate = totalCheckIns > 0 ? Math.round((pontualCount / totalCheckIns) * 100) : 100;
        const validationRate = (completedCount + invalidatedCount) > 0
          ? Math.round((completedCount / (completedCount + invalidatedCount)) * 100)
          : 100;

        // Elegibilidade por plantão (usando pré-carga para evitar N×M queries)
        const boothsStatus = await Promise.all(
          boothsForEligibility.map(async (b) => {
            const ruleSet = boothRuleSetsForReport.get(b.id)!;
            const metrics = await this.getCurrentWeekPeriodMetrics(broker.id, tenantId, b.id);
            const satReq = ruleSet.saturday_required_periods ?? 5;
            const sunReq = ruleSet.sunday_required_periods ?? 6;
            const satEligible = ruleSet.weekend_enabled !== false && metrics.validPeriods >= satReq;
            const sunEligible = ruleSet.weekend_enabled !== false && metrics.validPeriods >= sunReq;
            return {
              boothId: b.id,
              boothName: b.name,
              validRoletasThisWeek: metrics.validPeriods,
              saturdayRequired: satReq,
              sundayRequired: sunReq,
              saturdayEligible: satEligible,
              sundayEligible: sunEligible,
            };
          }),
        );
        const weekendEligibleSaturday = boothsStatus.some((b) => b.saturdayEligible);
        const weekendEligibleSunday = boothsStatus.some((b) => b.sundayEligible);
        // Mantém weekendEligible como booleano de compatibilidade
        const weekendEligible = weekendEligibleSaturday || weekendEligibleSunday;
        const currentWeekValidRoletas = boothsStatus.length > 0 ? Math.max(...boothsStatus.map((b) => b.validRoletasThisWeek)) : 0;

        return {
          brokerId: broker.id,
          name: broker.name,
          nomeGuerra: broker.nome_guerra || broker.name,
          creci: broker.creci || null,
          brokerStage: broker.broker_stage || 'corretor_creci',
          managerId: broker.manager_id,
          managerName: broker.manager_id ? (managerMap.get(broker.manager_id) || 'Sem Gerente') : 'Sem Gerente',
          totalCheckIns,
          completedCount,
          invalidatedCount,
          onlineCount,
          pontualCount,
          posBarraCount,
          totalMinutes,
          totalHoursFormatted: `${hours}h ${minutes}m`,
          punctualityRate,
          validationRate,
          weekendEligible,
          weekendEligibleSaturday,
          weekendEligibleSunday,
          boothsStatus,
          currentWeekValidRoletas,
        };
      }),
    );

    return {
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      totalBrokers: brokers.length,
      activeBrokersWithCheckins: report.filter((r) => r.totalCheckIns > 0).length,
      brokers: report.sort((a, b) => b.totalCheckIns - a.totalCheckIns),
    };
  }

  // 15. RELATÓRIO DE GERENTES: Ranking Comparativo de Equipes
  async getManagersExecutiveReport(
    tenantId: string,
    startDateStr?: string,
    endDateStr?: string,
  ) {
    const now = new Date();
    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const [curYear, curMonth] = tzNow.dateStr.split('-').map(Number);
    const startDate = startDateStr
      ? getDateAtTimeInTimezone(startDateStr, '00:00')
      : getDateAtTimeInTimezone(
          `${curYear}-${String(curMonth).padStart(2, '0')}-01`,
          '00:00',
        );
    const endDate = endDateStr
      ? new Date(
          getDateAtTimeInTimezone(endDateStr, '00:00').getTime() +
            24 * 60 * 60 * 1000 -
            1,
        )
      : new Date(
          getDateAtTimeInTimezone(tzNow.dateStr, '00:00').getTime() +
            24 * 60 * 60 * 1000 -
            1,
        );

    const userRepo = this.presenceRepository.manager.getRepository(User);
    const managers = await userRepo.find({
      where: { tenant_id: tenantId, role: 'gerencia_level_2', removed_at: IsNull() },
      order: { name: 'ASC' },
    });

    const allBrokers = await userRepo.find({
      where: { tenant_id: tenantId, role: 'corretor_level_3', removed_at: IsNull() },
    });

    const presences = await this.presenceRepository.find({
      where: {
        tenant_id: tenantId,
        check_in_at: Between(startDate, endDate),
      },
    });

    const presencesByBroker = new Map<string, Presence[]>();
    for (const p of presences) {
      const list = presencesByBroker.get(p.broker_id) || [];
      list.push(p);
      presencesByBroker.set(p.broker_id, list);
    }

    // Pré-carrega booths e ruleSets fora dos loops para evitar N×M queries
    const boothsForManagerReport = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
    });
    const boothRuleSetsForManager = new Map<string, BoothRuleSet>();
    for (const booth of boothsForManagerReport) {
      boothRuleSetsForManager.set(booth.id, await this.getRuleSetForBooth(booth));
    }

    const report = await Promise.all(
      managers.map(async (manager) => {
        const team = allBrokers.filter((b) => b.manager_id === manager.id);
        let teamTotalCheckIns = 0;
        let teamTotalMinutes = 0;
        let teamWeekendEligibleCount = 0;

        const brokerRanks = await Promise.all(
          team.map(async (b) => {
            const bPresences = presencesByBroker.get(b.id) || [];
            const checkIns = bPresences.length;
            const minutes = bPresences
              .filter((p) => p.status !== 'invalidated')
              .reduce((acc, p) => acc + this.getEffectiveMinutes(p, now), 0);
            teamTotalCheckIns += checkIns;
            teamTotalMinutes += minutes;

            // Elegibilidade: verificar se é elegível (sábado OU domingo) em pelo menos um plantão publicado
            const isEligibleAnyBooth = (await Promise.all(
              boothsForManagerReport.map(async (booth) => {
                const ruleSet = boothRuleSetsForManager.get(booth.id)!;
                const metrics = await this.getCurrentWeekPeriodMetrics(b.id, tenantId, booth.id);
                const satReq = ruleSet.saturday_required_periods ?? 5;
                const sunReq = ruleSet.sunday_required_periods ?? 6;
                if (ruleSet.weekend_enabled === false) return false;
                return metrics.validPeriods >= satReq || metrics.validPeriods >= sunReq;
              }),
            )).some(Boolean);

            if (isEligibleAnyBooth) {
              teamWeekendEligibleCount += 1;
            }

            return {
              brokerId: b.id,
              nomeGuerra: b.nome_guerra || b.name,
              checkIns,
              hoursFormatted: `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
            };
          }),
        );

        const avgPerBroker = team.length > 0 ? (teamTotalCheckIns / team.length).toFixed(1) : '0.0';
        const teamHours = Math.floor(teamTotalMinutes / 60);
        const teamMins = teamTotalMinutes % 60;

        return {
          managerId: manager.id,
          managerName: manager.name,
          nomeGuerra: manager.nome_guerra || manager.name,
          email: manager.email,
          teamSize: team.length,
          teamTotalCheckIns,
          teamTotalHoursFormatted: `${teamHours}h ${teamMins}m`,
          averageCheckInsPerBroker: Number(avgPerBroker),
          teamWeekendEligibleCount,
          topBrokers: brokerRanks.sort((a, b) => b.checkIns - a.checkIns).slice(0, 3),
        };
      }),
    );

    return {
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      totalManagers: managers.length,
      managers: report.sort((a, b) => b.teamTotalCheckIns - a.teamTotalCheckIns),
    };
  }

  // 16. RELATÓRIO DE PLANTÕES: Ocupação e Demanda por Estande
  async getBoothsExecutiveReport(
    tenantId: string,
    startDateStr?: string,
    endDateStr?: string,
  ) {
    const now = new Date();
    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const [curYear, curMonth] = tzNow.dateStr.split('-').map(Number);
    const startDate = startDateStr
      ? getDateAtTimeInTimezone(startDateStr, '00:00')
      : getDateAtTimeInTimezone(
          `${curYear}-${String(curMonth).padStart(2, '0')}-01`,
          '00:00',
        );
    const endDate = endDateStr
      ? new Date(
          getDateAtTimeInTimezone(endDateStr, '00:00').getTime() +
            24 * 60 * 60 * 1000 -
            1,
        )
      : new Date(
          getDateAtTimeInTimezone(tzNow.dateStr, '00:00').getTime() +
            24 * 60 * 60 * 1000 -
            1,
        );

    const booths = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
      order: { name: 'ASC' },
    });

    const presences = await this.presenceRepository.find({
      where: {
        tenant_id: tenantId,
        check_in_at: Between(startDate, endDate),
      },
    });

    const presencesByBooth = new Map<string, Presence[]>();
    for (const p of presences) {
      const list = presencesByBooth.get(p.booth_id) || [];
      list.push(p);
      presencesByBooth.set(p.booth_id, list);
    }

    const report = booths.map((booth) => {
      const bPresences = presencesByBooth.get(booth.id) || [];
      const totalCheckIns = bPresences.length;
      const uniqueBrokers = new Set(bPresences.map((p) => p.broker_id)).size;
      const totalMinutes = bPresences
        .filter((p) => p.status !== 'invalidated')
        .reduce((acc, p) => acc + this.getEffectiveMinutes(p, now), 0);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      const hourCounts: Record<number, number> = {};
      for (const p of bPresences) {
        const h = Number(
          new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })
            .format(new Date(p.check_in_at))
        ) % 24;
        hourCounts[h] = (hourCounts[h] || 0) + 1;
      }
      let peakHour: number | null = null;
      let maxCount = 0;
      for (const [h, count] of Object.entries(hourCounts)) {
        if (count > maxCount) {
          maxCount = count;
          peakHour = Number(h);
        }
      }

      return {
        boothId: booth.id,
        boothName: booth.name,
        address: booth.address,
        totalCheckIns,
        uniqueBrokersCount: uniqueBrokers,
        totalHoursFormatted: `${hours}h ${minutes}m`,
        peakHourFormatted: peakHour !== null ? `${String(peakHour).padStart(2, '0')}:00 às ${String(peakHour + 1).padStart(2, '0')}:00` : 'Sem registros',
      };
    });

    return {
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      totalBooths: booths.length,
      booths: report.sort((a, b) => b.totalCheckIns - a.totalCheckIns),
    };
  }
}