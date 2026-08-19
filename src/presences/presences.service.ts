// src/presences/presences.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule'; // Importa o decorador de tarefas agendadas

import { Presence } from './entities/presence.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { DeadManLog } from './entities/dead-man-log.entity';
import { CheckInDto } from './dto/check-in.dto';
import { PingResponseDto } from './dto/ping-response.dto';
import { Message } from '../messages/entities/message.entity'; // <-- ADICIONE ESTA LINHA
import { MessageRecipient } from '../messages/entities/message-recipient.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class PresencesService {
  constructor(
    @InjectRepository(Presence)
    private presenceRepository: Repository<Presence>,

    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,

    @InjectRepository(BoothRuleSet)
    private ruleSetRepository: Repository<BoothRuleSet>,

    @InjectRepository(DeadManLog)
    private logRepository: Repository<DeadManLog>,

    @InjectRepository(Message) // <-- ADICIONE ESTA INJEÇÃO
    private messageRepository: Repository<Message>,

    @InjectRepository(MessageRecipient)
    private recipientRepository: Repository<MessageRecipient>,
    private notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

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

    const booth = await this.boothRepository.findOne({
      where: { id: dto.boothId, tenant_id: tenantId },
      relations: { wifis: true },
    });

    if (!booth) {
      throw new NotFoundException('Plantão de vendas não encontrado ou sem autorização.');
    }
    if (booth.lifecycle_status !== 'published') {
      throw new BadRequestException('Este plantão não está publicado para novos Check-ins.');
    }

    const ruleSet = await this.getRuleSetForBooth(booth);
    const eligibility = await this.checkWeekendEligibility(brokerId, tenantId, ruleSet);
    if (!eligibility.eligible) {
      const dayName = new Date().getDay() === 6 ? 'Sábado' : 'Domingo';
      throw new BadRequestException(
        `Check-in bloqueado para este ${dayName}. Para trabalhar no fim de semana, é necessário acumular no mínimo ${eligibility.required} períodos de Segunda a Sexta. Você acumulou apenas ${eligibility.accumulated} períodos nesta semana.`,
      );
    }

    let isPresenceValid = false;
    let methodUsed = '';
    let distanceCalculated = 0;

    if (dto.ssid && booth.wifis && booth.wifis.length > 0) {
      const userSsid = dto.ssid;
      const wifiMatch = booth.wifis.some(
        (wifi) => wifi.ssid.toLowerCase() === userSsid.toLowerCase(),
      );

      if (wifiMatch) {
        isPresenceValid = true;
        methodUsed = 'Wi-Fi Corporativo';
      }
    }

    if (!isPresenceValid) {
      const boothLat = Number(booth.latitude);
      const boothLon = Number(booth.longitude);

      distanceCalculated = this.calculateDistanceInMeters(
        dto.latitude,
        dto.longitude,
        boothLat,
        boothLon,
      );

      if (distanceCalculated <= ruleSet.gps_radius_meters) {
        isPresenceValid = true;
        methodUsed = 'GPS de Alta Precisão';
      }
    }

    if (!isPresenceValid) {
      throw new BadRequestException(
        `Check-in recusado. Você está fora da área do plantão. Distância calculada: ${Math.round(distanceCalculated)} metros. Limite permitido: ${ruleSet.gps_radius_meters} metros.`,
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
      check_in_at: new Date(),
      last_confirmed_at: new Date(),
      next_confirmation_at: this.getNextAlignedConfirmationAt(new Date()),
      status: 'online',
    });

    const savedPresence = await this.presenceRepository.save(presence);
    this.realtimeService.publish({ eventType: 'presence.checked_in', tenantId, aggregateId: savedPresence.id, payload: { brokerId, boothId: dto.boothId, status: savedPresence.status, nextConfirmationAt: savedPresence.next_confirmation_at } });

    return {
      message: 'Check-in realizado com sucesso! Presença confirmada.',
      presenceId: savedPresence.id,
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
    const diffInMs = now.getTime() - activePresence.check_in_at.getTime();
    const elapsedMinutes = Math.floor(diffInMs / 1000 / 60);

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
    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
    });
    const activeBooth = activePresence
      ? await this.boothRepository.findOne({ where: { id: activePresence.booth_id, tenant_id: tenantId } })
      : null;
    const activeRuleSet = activeBooth ? await this.getRuleSetForBooth(activeBooth) : undefined;
    const weeklyMetrics = await this.getCurrentWeekPeriodMetrics(brokerId, tenantId);
    const accumulatedPeriods = weeklyMetrics.weightedPeriods;
    const eligibility = await this.checkWeekendEligibility(brokerId, tenantId, activeRuleSet, accumulatedPeriods);
    const activeMinutes = activePresence
      ? Math.floor((Date.now() - activePresence.check_in_at.getTime()) / 1000 / 60)
      : 0;
    const minimumMinutes = activePresence?.minimum_period_minutes || activeRuleSet?.minimum_period_minutes || 120;

    return {
      week: 'Segunda a sexta-feira',
      accumulatedPeriods,
      validPeriods: weeklyMetrics.validPeriods,
      weightedPeriods: weeklyMetrics.weightedPeriods,
      invalidatedPeriods: weeklyMetrics.invalidatedPeriods,
      weekendEligibility: eligibility,
      minimumMinutesPerPeriod: minimumMinutes,
      weekStart: weeklyMetrics.startOfWeek.toISOString(),
      weekEnd: weeklyMetrics.endOfFriday.toISOString(),
      activeShift: activePresence
        ? {
            presenceId: activePresence.id,
            activeMinutes,
            minimumMinutes,
            minimumReached: activeMinutes >= minimumMinutes,
            lastConfirmedAt: activePresence.last_confirmed_at,
            nextConfirmationAt: activePresence.next_confirmation_at,
            confirmationToleranceMinutes: activeRuleSet ? this.getConfirmationToleranceMinutes(activeRuleSet) : 5,
          }
        : null,
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

  // 6. Motor interno de verificação: executa a cada 5 minutos, sem suspender antes da janela configurada.
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

  // 8. Retorna métricas explícitas de períodos da semana atual.
  private async getCurrentWeekPeriodMetrics(brokerId: string, tenantId: string) {
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

    // Busca todas as presenças concluídas ("completed") no intervalo de segunda a sexta desta semana
    const presences = await this.presenceRepository.createQueryBuilder('presence')
      .where('presence.broker_id = :brokerId', { brokerId })
      .andWhere('presence.tenant_id = :tenantId', { tenantId })
      .andWhere('presence.status IN (:...statuses)', { statuses: ['completed', 'invalidated'] })
      .andWhere('presence.check_in_at BETWEEN :start AND :end', { start: startOfWeek, end: endOfFriday })
      .getMany();

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

  private async getAccumulatedPeriodsForCurrentWeek(brokerId: string, tenantId: string): Promise<number> {
    const metrics = await this.getCurrentWeekPeriodMetrics(brokerId, tenantId);
    return metrics.weightedPeriods;
  }

  // 9. Valida a elegibilidade do corretor para check-in de fim de semana [9]
  private async checkWeekendEligibility(
    brokerId: string,
    tenantId: string,
    ruleSet?: BoothRuleSet,
    accumulatedOverride?: number,
  ): Promise<{ eligible: boolean; accumulated: number; required: number }> {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Domingo, 6 = Sábado
    const accumulated = accumulatedOverride ?? await this.getAccumulatedPeriodsForCurrentWeek(brokerId, tenantId);
    
    // Em dias úteis o check-in é elegível, mas o acumulado real continua sendo devolvido ao dashboard.
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      return { eligible: true, accumulated, required: 0 };
    }
    let required = 0;

    if (dayOfWeek === 6) {
      required = ruleSet?.saturday_required_periods ?? 5;
    } else if (dayOfWeek === 0) {
      required = ruleSet?.sunday_required_periods ?? 6;
    }

    const eligible = accumulated >= required;

    return {
      eligible,
      accumulated,
      required,
    };
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
  async getBrokerMonthlyStatistics(brokerId: string, tenantId: string, month: number, year: number) {
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
      .getMany();

    const validCompletedPresences = completedPresences.filter(
      (presence) => presence.accumulated_minutes >= presence.minimum_period_minutes,
    );
    const completedPeriodsWeightSum = validCompletedPresences.reduce((sum, presence) => sum + Number(presence.period_weight || 1), 0);
    const completedPeriodsCount = validCompletedPresences.length;

    const availablePeriodsGoal = validCompletedPresences[0]?.minimum_monthly_periods || 20; 

    // Calcula a porcentagem de assiduidade real
    const presencePercentage = Math.round((completedPeriodsWeightSum / availablePeriodsGoal) * 100);

    return {
      brokerId,
      month,
      year,
      completedPeriods: completedPeriodsCount,
      completedPeriodsWeightSum,
      monthlyGoal: availablePeriodsGoal,
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
}