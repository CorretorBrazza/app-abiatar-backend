import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Between } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule'; // Importa o decorador de tarefas agendadas

import { Presence } from './entities/presence.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { BoothHoliday } from '../booths/entities/booth-holiday.entity';
import { BoothSpecialSchedule } from '../booths/entities/booth-special-schedule.entity';
import { DeadManLog } from './entities/dead-man-log.entity';
import { CheckInDto } from './dto/check-in.dto';
import { PingResponseDto } from './dto/ping-response.dto';
import { Message } from '../messages/entities/message.entity'; // <-- ADICIONE ESTA LINHA
import { MessageRecipient } from '../messages/entities/message-recipient.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { getNowInTimezone, timeStringToMinutes, minutesToTimeString, TimezoneNow } from '../utils/timezone.util';

@Injectable()
export class PresencesService {
  constructor(
    @InjectRepository(Presence)
    private presenceRepository: Repository<Presence>,

    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,

    @InjectRepository(BoothRuleSet)
    private ruleSetRepository: Repository<BoothRuleSet>,

    @InjectRepository(BoothHoliday)
    private holidayRepository: Repository<BoothHoliday>,

    @InjectRepository(BoothSpecialSchedule)
    private specialScheduleRepository: Repository<BoothSpecialSchedule>,

    @InjectRepository(DeadManLog)
    private logRepository: Repository<DeadManLog>,

    @InjectRepository(Message) // <-- ADICIONE ESTA INJEÇÃO
    private messageRepository: Repository<Message>,

    @InjectRepository(MessageRecipient)
    private recipientRepository: Repository<MessageRecipient>,
    private notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

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

  private getNextAlignedConfirmationAt(from: Date): Date {
    const next = new Date(from);
    const minute = next.getMinutes();
    if (minute < 25) next.setMinutes(25, 0, 0);
    else if (minute < 50) next.setMinutes(50, 0, 0);
    else { next.setHours(next.getHours() + 1); next.setMinutes(0, 0, 0); }
    return next;
  }

  private getConfirmationToleranceMinutes(ruleSet: BoothRuleSet): number {
    return Math.max(0, Math.min(5, Number(ruleSet.ping_response_deadline_minutes ?? 5)));
  }

  // 2. Realiza o Check-in com validação por Dupla Camada (GPS ou Wi-Fi)
  async checkIn(dto: CheckInDto, brokerId: string, tenantId: string) {

  

    // A. Verifica se o corretor já possui um check-in ativo ("online") no momento
    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
    });

    if (activePresence) {
      throw new BadRequestException('Você já possui um check-in ativo. Finalize o turno atual antes de iniciar outro.');
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

      distanceCalculated = this.calculateDistanceInMeters(
        dto.latitude,
        dto.longitude,
        Number(booth.latitude),
        Number(booth.longitude),
      );

      if (distanceCalculated <= ruleSet.gps_radius_meters) {
        isLocationValid = true;
        methodUsed = `GPS (${Math.round(distanceCalculated)}m)`;
      }
    }

    if (!isLocationValid) {
      throw new BadRequestException(
        `Check-in recusado. Você está fora da área do plantão. Distância calculada: ${Math.round(distanceCalculated)} metros. Limite permitido: ${ruleSet.gps_radius_meters} metros.`,
      );
    }

    const tzNow = getNowInTimezone('America/Sao_Paulo');
    const nowMinutes = tzNow.nowMinutes;
    const now = new Date();
    const specialInfo = await this.getSpecialScheduleForBooth(dto.boothId, tenantId, tzNow);
    const holidayInfo = await this.getHolidayForBoothAndDate(dto.boothId, tenantId, now);

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

    let assignedRoletaName = '';
    let assignedEntryType: 'pontual' | 'pos_barra' = 'pontual';
    let assignedValidationStartsAt: Date = now;
    let assignedPosition: number | null = null;
    let assignedDrawTimeStr = '09:01';

    let matchingRoleta: any = null;
    for (const r of roletaTimes) {
      const roletaMinutes = timeStringToMinutes(r.time);
      const earlyOpenMinutes = roletaMinutes - earlyMinutes;
      const drawMinutes = roletaMinutes + 1;
      const posBarraEndMinutes = roletaMinutes + posBarraMinutes;

      const drawStr = minutesToTimeString(drawMinutes);

      if (nowMinutes >= earlyOpenMinutes && nowMinutes <= posBarraEndMinutes) {
        matchingRoleta = {
          name: r.name,
          roletaMinutes,
          earlyOpenMinutes,
          drawMinutes,
          drawTimeFormatted: drawStr,
          posBarraEndMinutes,
          isPontual: nowMinutes < drawMinutes,
          isPosBarra: nowMinutes >= drawMinutes && nowMinutes <= posBarraEndMinutes,
        };
        break;
      }
    }

    // TRAVA ESTRITA: Se estiver fora das janelas de check-in permitidas hoje, REJEITA imediatamente!
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

    assignedRoletaName = matchingRoleta.name;
    assignedDrawTimeStr = matchingRoleta.drawTimeFormatted;

    if (matchingRoleta.isPontual) {
      assignedEntryType = 'pontual';
      assignedValidationStartsAt = now;
      assignedPosition = null; // Fica aguardando o sorteio automático exatamente às 09:01 / 13:31 / 14:01
    } else {
      assignedEntryType = 'pos_barra';
      assignedValidationStartsAt = now; // No pós-barra, os 120 min contam a partir da chegada
      
      // Pós-Barra entra automaticamente no final da fila
      const existingInBooth = await this.presenceRepository.find({
        where: {
          booth_id: dto.boothId,
          tenant_id: tenantId,
          status: 'online',
          roleta_name: assignedRoletaName,
        },
      });
      const maxPos = existingInBooth.reduce((max, p) => Math.max(max, p.roleta_position || 0), 0);
      assignedPosition = maxPos + 1;
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
      next_confirmation_at: this.getNextAlignedConfirmationAt(now),
      status: 'online',
    });

    const savedPresence = await this.presenceRepository.save(presence);
    this.realtimeService.publish({ eventType: 'presence.checked_in', tenantId, aggregateId: savedPresence.id, payload: { brokerId, boothId: dto.boothId, status: savedPresence.status, nextConfirmationAt: savedPresence.next_confirmation_at, roletaPosition: savedPresence.roleta_position, roletaEntryType: savedPresence.roleta_entry_type, drawTimeFormatted: assignedDrawTimeStr } });

    // Tenta processar sorteios pendentes caso o check-in ocorra no marco do sorteio
    void this.processRoletaDraws();

    return {
      message: assignedEntryType === 'pos_barra'
        ? `Check-in Pós-Barra confirmado! Você assumiu o ${assignedPosition}º Lugar no final da fila.`
        : `Check-in Pontual confirmado! Aguarde o sorteio da Roleta exatamente às ${assignedDrawTimeStr}.`,
      presenceId: savedPresence.id,
      roletaName: savedPresence.roleta_name,
      roletaEntryType: savedPresence.roleta_entry_type,
      roletaPosition: savedPresence.roleta_position,
      drawTimeFormatted: assignedDrawTimeStr,
      methodUsed: methodUsed,
      distanceInMeters: Math.round(distanceCalculated),
    };
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
      ping_interval_minutes: 25,
      ping_response_deadline_minutes: 5,
      minimum_brokers_required: booth.min_brokers_required,
      gps_radius_meters: booth.gps_radius,
      weekend_enabled: true,
      minimum_monthly_periods: 20,
      created_by: null,
    });
  }

  // 3. Realiza o Check-out voluntário e calcula o tempo total acumulado em minutos
  async checkOut(brokerId: string, tenantId: string) {
    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
    });

    if (!activePresence) {
      throw new NotFoundException('Você não possui nenhum check-in ativo para finalizar.');
    }

    const now = new Date();
    const countStart = activePresence.validation_starts_at || activePresence.check_in_at;
    const diffInMs = now.getTime() - countStart.getTime();
    const elapsedMinutes = Math.max(0, Math.floor(diffInMs / 1000 / 60));

    activePresence.check_out_at = now;
    activePresence.accumulated_minutes = elapsedMinutes;
    activePresence.status = elapsedMinutes >= activePresence.minimum_period_minutes ? 'completed' : 'invalidated';

    const savedPresence = await this.presenceRepository.save(activePresence);
    this.realtimeService.publish({ eventType: 'presence.checked_out', tenantId, aggregateId: savedPresence.id, payload: { brokerId, boothId: savedPresence.booth_id, status: savedPresence.status, accumulatedMinutes: savedPresence.accumulated_minutes } });

    // DISPARA O ALERTA PREDITIVO DE COBERTURA BAIXA NA SAÍDA DO CORRETOR [6]
    await this.checkAndNotifyLowCoverage(activePresence.booth_id, tenantId);

    return {
      message: elapsedMinutes >= activePresence.minimum_period_minutes
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
    if (activePresence && activePresence.roleta_position) {
      const presencesInBooth = await this.presenceRepository.find({
        where: {
          booth_id: activePresence.booth_id,
          tenant_id: tenantId,
          status: 'online',
          roleta_name: activePresence.roleta_name || undefined,
        },
        relations: { broker: true },
        order: { roleta_position: 'ASC' },
      });

      boothQueue = presencesInBooth
        .filter((p) => p.roleta_position !== null)
        .map((p) => ({
          brokerId: p.broker_id,
          nomeGuerra: p.broker?.nome_guerra || 'Corretor',
          roletaPosition: p.roleta_position,
          roletaEntryType: p.roleta_entry_type,
          minutesActive: Math.max(0, Math.floor((Date.now() - new Date(p.validation_starts_at || p.check_in_at).getTime()) / 1000 / 60)),
          isCurrentBroker: p.broker_id === brokerId,
        }));
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
            roletaPosition: activePresence.roleta_position,
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

    return {
      totalTeamBrokers: brokers.length,
      saturdayEligibleCount,
      sundayEligibleCount,
      inProgressCount: Math.max(0, brokers.length - saturdayEligibleCount),
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

    const booth = ping.presence.booth;
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
    if (!isPresenceValid) {
      const boothLat = Number(booth.latitude);
      const boothLon = Number(booth.longitude);

      distanceCalculated = this.calculateDistanceInMeters(
        dto.latitude,
        dto.longitude,
        boothLat,
        boothLon,
      );

      if (distanceCalculated <= booth.gps_radius) {
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
      ping.presence.next_confirmation_at = this.getNextAlignedConfirmationAt(new Date());
      await this.presenceRepository.save(ping.presence);
      this.realtimeService.publish({ eventType: 'presence.confirmed', tenantId, aggregateId: ping.presence.id, payload: { brokerId, boothId: ping.presence.booth_id, method: methodUsed, nextConfirmationAt: ping.presence.next_confirmation_at } });

      return {
        message: 'Presença confirmada com sucesso!',
        status: methodUsed,
        distanceInMeters: Math.round(distanceCalculated),
      };
    } else {
      // Se responder estando FORA da área, o corretor é suspenso por "Ausência" imediatamente [8]
      ping.response_status = 'outside_area';
      await this.logRepository.save(ping);

      ping.presence.status = 'absent';
      await this.presenceRepository.save(ping.presence);

      throw new BadRequestException(
        `Presença suspensa. Você respondeu ao ping fora do perímetro permitido do plantão. Distância calculada: ${Math.round(distanceCalculated)} metros.`,
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
      const pingIntervalMinutes = 25;
      const responseDeadlineMinutes = this.getConfirmationToleranceMinutes(ruleSet);

      // Busca se já existe um ping "pendente" lançado anteriormente para essa presença
      const pendingPing = await this.logRepository.findOne({
        where: { presence_id: presence.id, response_status: 'pending' },
        order: { sent_at: 'DESC' },
      });

      if (pendingPing) {
        // O prazo é configurável por plantão; o padrão é 30 minutos.
        const diffInMs = now.getTime() - pendingPing.sent_at.getTime();
        const minutesElapsed = Math.floor(diffInMs / 1000 / 60);

        if (minutesElapsed >= responseDeadlineMinutes) {
          pendingPing.response_status = 'no_response';
          await this.logRepository.save(pendingPing);

          presence.status = 'absent'; // Presença suspensa [8]
          await this.presenceRepository.save(presence);
          this.realtimeService.publish({ eventType: 'presence.absent', tenantId: presence.tenant_id, aggregateId: presence.id, payload: { brokerId: presence.broker_id, boothId: presence.booth_id, reason: 'no_response' } });
          brokersSuspended++;
          console.log(`[CRON] Presença ${presence.id} suspensa por falta de resposta.`);
          void this.notificationsService.sendToUser(
            presence.broker_id,
            presence.tenant_id,
            'Presença suspensa',
            'Não recebemos sua confirmação de presença. O turno foi colocado em pausa.',
            { type: 'presence_suspended', presenceId: presence.id },
          );
        }
      } else {
        const lastPing = await this.logRepository.findOne({
          where: { presence_id: presence.id },
          order: { sent_at: 'DESC' },
        });
        const scheduledAt = presence.next_confirmation_at || (lastPing ? this.getNextAlignedConfirmationAt(lastPing.sent_at) : this.getNextAlignedConfirmationAt(presence.check_in_at));
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
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    
    // Calcula o início da Segunda-feira da semana atual (00:00:00)
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay; // Ajuste se for Domingo
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + mondayOffset);
    startOfWeek.setHours(0, 0, 0, 0);

    // Calcula o final da Sexta-feira da semana atual (23:59:59)
    const endOfFriday = new Date(startOfWeek);
    endOfFriday.setDate(startOfWeek.getDate() + 4); // Segunda + 4 dias = Sexta
    endOfFriday.setHours(23, 59, 59, 999);

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
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Domingo, 6 = Sábado
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
    dto: { brokerId?: string; boothId?: string; roletaPosition?: number } = {},
  ) {
    const targetBrokerId = (['diretoria_level_1', 'gerencia_level_2', 'recepcao_level_3', 'platform_admin_level_0'].includes(actor.role)) && dto.brokerId
      ? dto.brokerId
      : actor.sub;

    const broker = await this.presenceRepository.manager.getRepository(User).findOne({ where: { id: targetBrokerId, tenant_id: tenantId } });
    if (!broker) throw new NotFoundException('Corretor não encontrado.');

    let booth: Booth | null = null;
    if (dto.boothId) {
      booth = await this.boothRepository.findOne({ where: { id: dto.boothId, tenant_id: tenantId } });
    }
    if (!booth) {
      booth = await this.boothRepository.findOne({ where: { tenant_id: tenantId, lifecycle_status: 'published' } });
    }
    if (!booth) throw new NotFoundException('Nenhum plantão publicado encontrado para check-in.');

    // Finaliza presenças ativas anteriores
    await this.presenceRepository.update(
      { broker_id: broker.id, tenant_id: tenantId, status: 'online' },
      { status: 'completed', check_out_at: new Date() }
    );

    const now = new Date();
    const ruleSet = await this.getRuleSetForBooth(booth);
    const pos = dto.roletaPosition || 1;

    const presence = this.presenceRepository.create({
      tenant_id: tenantId,
      broker_id: broker.id,
      booth_id: booth.id,
      rule_set_id: ruleSet.id || null,
      minimum_period_minutes: ruleSet.minimum_period_minutes || 120,
      period_weight: ruleSet.period_weight || 1,
      minimum_monthly_periods: ruleSet.minimum_monthly_periods || 20,
      roleta_name: 'Roleta 1 (Manhã)',
      roleta_entry_type: 'pontual',
      roleta_position: pos,
      validation_starts_at: now,
      check_in_at: now,
      last_confirmed_at: now,
      next_confirmation_at: this.getNextAlignedConfirmationAt(now),
      accumulated_minutes: 25,
      status: 'online',
    });

    const saved = await this.presenceRepository.save(presence);
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
        nextConfirmationAt: saved.next_confirmation_at,
      },
    });

    return {
      message: `Check-in ativo registrado para o corretor '${broker.nome_guerra}' no plantão '${booth.name}'!`,
      presence: {
        id: saved.id,
        boothId: booth.id,
        boothName: booth.name,
        brokerId: broker.id,
        brokerName: broker.nome_guerra,
        status: saved.status,
        roletaPosition: saved.roleta_position,
        roletaName: saved.roleta_name,
        checkInAt: saved.check_in_at,
      },
    };
  }

  // 13. RELATÓRIO EXECUTIVO EM TEMPO REAL: Torre de Controle da Diretoria
  async getRealtimeExecutiveReport(tenantId: string) {
    const booths = await this.boothRepository.find({
      where: { tenant_id: tenantId, lifecycle_status: 'published' },
      order: { name: 'ASC' },
    });

    const activePresences = await this.presenceRepository.find({
      where: { tenant_id: tenantId, status: 'online' },
      relations: { broker: true, booth: true },
      order: { roleta_position: 'ASC', check_in_at: 'ASC' },
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

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

    const boothsReport = await Promise.all(
      booths.map(async (booth) => {
        const ruleSet = await this.getRuleSetForBooth(booth);
        const onlineInBooth = presencesByBooth.get(booth.id) || [];
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

        return {
          boothId: booth.id,
          boothName: booth.name,
          address: booth.address,
          onlineCount: onlineInBooth.length,
          minRequired,
          isUnderstaffed,
          hasBrokers: onlineInBooth.length > 0,
          onlineBrokers,
        };
      }),
    );

    const activeBoothsCount = boothsReport.filter((b) => b.hasBrokers).length;
    const emptyBoothsCount = boothsReport.filter((b) => !b.hasBrokers).length;
    const understaffedBoothsCount = boothsReport.filter((b) => b.isUnderstaffed).length;
    const totalTodayMinutes = todayPresences.reduce((acc, p) => acc + (p.accumulated_minutes || 0), 0);

    return {
      updatedAt: now.toISOString(),
      totalBooths: booths.length,
      activeBoothsCount,
      emptyBoothsCount,
      understaffedBoothsCount,
      onlineBrokersCount: activePresences.length,
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
    let startDate: Date;
    let endDate: Date;

    if (startDateStr) {
      const [y, m, d] = startDateStr.split('-').map(Number);
      startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    if (endDateStr) {
      const [y, m, d] = endDateStr.split('-').map(Number);
      endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

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

    const report = await Promise.all(
      brokers.map(async (broker) => {
        const brokerPresences = presencesByBroker.get(broker.id) || [];
        const totalCheckIns = brokerPresences.length;
        const completedCount = brokerPresences.filter((p) => p.status === 'completed').length;
        const invalidatedCount = brokerPresences.filter((p) => p.status === 'invalidated').length;
        const onlineCount = brokerPresences.filter((p) => p.status === 'online').length;
        const pontualCount = brokerPresences.filter((p) => p.roleta_entry_type === 'pontual').length;
        const posBarraCount = brokerPresences.filter((p) => p.roleta_entry_type === 'pos_barra').length;
        const totalMinutes = brokerPresences.reduce((acc, p) => acc + (p.accumulated_minutes || 0), 0);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const punctualityRate = totalCheckIns > 0 ? Math.round((pontualCount / totalCheckIns) * 100) : 100;
        const validationRate = (completedCount + invalidatedCount) > 0
          ? Math.round((completedCount / (completedCount + invalidatedCount)) * 100)
          : 100;

        const weeklyMetrics = await this.getCurrentWeekPeriodMetrics(broker.id, tenantId);
        const weekendEligible = weeklyMetrics.validPeriods >= 5;

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
          currentWeekValidRoletas: weeklyMetrics.validPeriods,
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
    let startDate: Date;
    let endDate: Date;

    if (startDateStr) {
      const [y, m, d] = startDateStr.split('-').map(Number);
      startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    if (endDateStr) {
      const [y, m, d] = endDateStr.split('-').map(Number);
      endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

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
            const minutes = bPresences.reduce((acc, p) => acc + (p.accumulated_minutes || 0), 0);
            teamTotalCheckIns += checkIns;
            teamTotalMinutes += minutes;

            const weeklyMetrics = await this.getCurrentWeekPeriodMetrics(b.id, tenantId);
            if (weeklyMetrics.validPeriods >= 5) {
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
    let startDate: Date;
    let endDate: Date;

    if (startDateStr) {
      const [y, m, d] = startDateStr.split('-').map(Number);
      startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    if (endDateStr) {
      const [y, m, d] = endDateStr.split('-').map(Number);
      endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

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
      const totalMinutes = bPresences.reduce((acc, p) => acc + (p.accumulated_minutes || 0), 0);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      const hourCounts: Record<number, number> = {};
      for (const p of bPresences) {
        const h = new Date(p.check_in_at).getHours();
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