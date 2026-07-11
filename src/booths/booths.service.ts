// src/booths/booths.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booth } from './entities/booth.entity';
import { BoothWifi } from './entities/booth-wifi.entity';
import { CreateBoothDto } from './dto/create-booth.dto';

@Injectable()
export class BoothsService {
  constructor(
    @InjectRepository(Booth)
    private boothRepository: Repository<Booth>,

    @InjectRepository(BoothWifi)
    private wifiRepository: Repository<BoothWifi>,
  ) {}

  // 1. Cadastra um novo plantão de vendas com seus respectivos Wi-Fis
  async create(dto: CreateBoothDto, tenantId: string): Promise<Booth> {
    // Cria o registro do Plantão vinculado ao tenant
    const booth = this.boothRepository.create({
      tenant_id: tenantId,
      name: dto.name,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      gps_radius: dto.gps_radius || 100, // Padrão de 100m se não enviado
    });

    const savedBooth = await this.boothRepository.save(booth);

    // Se houver Wi-Fis enviados, salva-os vinculados a este plantão
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

    // Retorna o plantão já com as suas redes Wi-Fi associadas
    return this.findOne(savedBooth.id, tenantId);
  }

  // 2. Retorna todos os plantões cadastrados daquela construtora específica
  async findAll(tenantId: string): Promise<Booth[]> {
    return this.boothRepository.find({
      where: { tenant_id: tenantId },
      relations: { wifis: true }, // Traz junto as redes Wi-Fi associadas
      order: { name: 'ASC' },
    });
  }

  // 3. Busca um único plantão por ID, validando se pertence ao tenant solicitante
  async findOne(id: string, tenantId: string): Promise<Booth> {
    const booth = await this.boothRepository.findOne({
      where: { id: id, tenant_id: tenantId },
      relations: { wifis: true },
    });

    if (!booth) {
      throw new NotFoundException('Plantão de vendas não encontrado ou sem autorização de acesso.');
    }

    return booth;
  }

  // 4. Remove um plantão de vendas (as redes Wi-Fi associadas caem em cascata no banco)
  async remove(id: string, tenantId: string): Promise<{ message: string }> {
    const booth = await this.findOne(id, tenantId); // Valida se o plantão existe e é do tenant
    await this.boothRepository.remove(booth);
    return { message: 'Plantão de vendas e redes Wi-Fi removidos com sucesso.' };
  }
}