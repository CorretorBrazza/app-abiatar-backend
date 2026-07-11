// src/presences/presences.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule'; // Importa o decorador de tarefas agendadas

import { Presence } from './entities/presence.entity';
import { Booth } from '../booths/entities/booth.entity';
import { DeadManLog } from './entities/dead-man-log.entity';
import { CheckInDto } from './dto/check-in.dto';
import { PingResponseDto } from './dto/ping-response.dto';

@Injectable()
export class PresencesService {
  constructor(
    @InjectRepository(Presence)
    private presenceRepository: Repository<Presence>,

    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,

    @InjectRepository(DeadManLog)
    private logRepository: Repository<DeadManLog>,
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

  // 2. Realiza o Check-in com validação por Dupla Camada (GPS ou Wi-Fi)
  async checkIn(dto: CheckInDto, brokerId: string, tenantId: string) {
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

      if (distanceCalculated <= booth.gps_radius) {
        isPresenceValid = true;
        methodUsed = 'GPS de Alta Precisão';
      }
    }

    if (!isPresenceValid) {
      throw new BadRequestException(
        `Check-in recusado. Você está fora da área do plantão. Distância calculada: ${Math.round(distanceCalculated)} metros. Limite permitido: ${booth.gps_radius} metros.`,
      );
    }

    const presence = this.presenceRepository.create({
      tenant_id: tenantId,
      broker_id: brokerId,
      booth_id: dto.boothId,
      check_in_at: new Date(),
      status: 'online',
    });

    const savedPresence = await this.presenceRepository.save(presence);

    return {
      message: 'Check-in realizado com sucesso! Presença confirmada.',
      presenceId: savedPresence.id,
      methodUsed: methodUsed,
      distanceInMeters: Math.round(distanceCalculated),
    };
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
    activePresence.status = 'completed';

    const savedPresence = await this.presenceRepository.save(activePresence);

    return {
      message: 'Check-out realizado com sucesso! Turno finalizado.',
      presenceId: savedPresence.id,
      checkInAt: savedPresence.check_in_at,
      checkOutAt: savedPresence.check_out_at,
      totalMinutes: savedPresence.accumulated_minutes,
    };
  }

  // 4. Busca se o corretor logado já possui uma sessão de check-in ativa (PWA Session Recovery)
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

    return {
      hasActiveSession: true,
      presence: {
        id: activePresence.id,
        boothId: activePresence.booth_id,
        boothName: activePresence.booth.name,
        checkInAt: activePresence.check_in_at,
        status: activePresence.status,
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
      await this.presenceRepository.save(ping.presence);

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

  // 6. Motor Agendador Cron: Roda a cada 30 minutos em segundo plano [8, 18]
  @Cron(CronExpression.EVERY_30_MINUTES)
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
      // Busca se já existe um ping "pendente" lançado anteriormente para essa presença
      const pendingPing = await this.logRepository.findOne({
        where: { presence_id: presence.id, response_status: 'pending' },
        order: { sent_at: 'DESC' },
      });

      if (pendingPing) {
        // Se existe um ping pendente enviado há mais de 5 minutos e não respondido:
        // O corretor é suspenso por falta de resposta! [8]
        const diffInMs = now.getTime() - pendingPing.sent_at.getTime();
        const minutesElapsed = Math.floor(diffInMs / 1000 / 60);

        if (minutesElapsed >= 5) {
          pendingPing.response_status = 'no_response';
          await this.logRepository.save(pendingPing);

          presence.status = 'absent'; // Presença suspensa [8]
          await this.presenceRepository.save(presence);
          brokersSuspended++;
          console.log(`[CRON] Presença ${presence.id} suspensa por falta de resposta.`);
        }
      } else {
        // Se não há pings pendentes ou o anterior foi respondido, "dispara" um novo ping na nuvem [8]
        const newPing = this.logRepository.create({
          tenant_id: presence.tenant_id,
          presence_id: presence.id,
          response_status: 'pending',
        });
        await this.logRepository.save(newPing);
        pingsGenerated++;
        console.log(`[CRON] Novo ping pendente gerado para a presença ${presence.id}.`);
      }
    }

    return {
      processedPresences: activePresences.length,
      pingsGenerated,
      brokersSuspended,
    };
  }
}