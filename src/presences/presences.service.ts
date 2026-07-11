// src/presences/presences.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Presence } from './entities/presence.entity';
import { Booth } from '../booths/entities/booth.entity';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class PresencesService {
  constructor(
    @InjectRepository(Presence)
    private presenceRepository: Repository<Presence>,

    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,
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
    // A. Verifica se o corretor já possui um check-in ativo ("online") no momento
    const activePresence = await this.presenceRepository.findOne({
      where: { broker_id: brokerId, tenant_id: tenantId, status: 'online' },
    });

    if (activePresence) {
      throw new BadRequestException('Você já possui um check-in ativo. Finalize o turno atual antes de iniciar outro.');
    }

    // B. Busca o plantão de destino trazendo as suas redes Wi-Fi autorizadas
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

// C. CAMADA 1: Validação por Wi-Fi Corporativo (Se o SSID foi enviado)
    if (dto.ssid && booth.wifis && booth.wifis.length > 0) {
      const userSsid = dto.ssid; // <-- ADICIONE ESTA CONSTANTE AUXILIAR
      
      // Verifica se o SSID do corretor bate silenciosamente com algum Wi-Fi do plantão
      const wifiMatch = booth.wifis.some(
        (wifi) => wifi.ssid.toLowerCase() === userSsid.toLowerCase(), // <-- USE A CONSTANTE AQUI
      );

      if (wifiMatch) {
        isPresenceValid = true;
        methodUsed = 'Wi-Fi Corporativo';
      }
    }

    // D. CAMADA 2: Validação por GPS (Se o Wi-Fi não bateu ou não foi enviado)
    if (!isPresenceValid) {
      // Como o Postgres salva decimais como strings no TypeORM por segurança, convertemos para Number
      const boothLat = Number(booth.latitude);
      const boothLon = Number(booth.longitude);

      distanceCalculated = this.calculateDistanceInMeters(
        dto.latitude,
        dto.longitude,
        boothLat,
        boothLon,
      );

      // Verifica se a distância calculada está dentro do raio configurado pela Diretoria
      if (distanceCalculated <= booth.gps_radius) {
        isPresenceValid = true;
        methodUsed = 'GPS de Alta Precisão';
      }
    }

    // E. Se ambas as camadas falharem, o check-in é recusado
    if (!isPresenceValid) {
      throw new BadRequestException(
        `Check-in recusado. Você está fora da área do plantão. Distância calculada: ${Math.round(distanceCalculated)} metros. Limite permitido: ${booth.gps_radius} metros.`,
      );
    }

    // F. Salva o registro de Presença física como "online"
    const presence = this.presenceRepository.create({
      tenant_id: tenantId,
      broker_id: brokerId,
      booth_id: dto.boothId,
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
}