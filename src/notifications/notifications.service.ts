// src/notifications/notifications.service.ts
import { Injectable, OnModuleInit, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { PushDeviceToken } from './entities/push-device-token.entity';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { SendOperationalPushDto } from './dto/send-operational-push.dto';
import { User } from '../users/user.entity';
import { Presence } from '../presences/entities/presence.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @InjectRepository(PushDeviceToken)
    private readonly pushTokenRepository: Repository<PushDeviceToken>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Presence)
    private readonly presenceRepository: Repository<Presence>,
    @InjectRepository(BoothReceptionist)
    private readonly receptionistRepository: Repository<BoothReceptionist>,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit() {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountVar && getApps().length === 0) {
      try {
        const serviceAccount = JSON.parse(serviceAccountVar);
        initializeApp({ credential: cert(serviceAccount) });
        console.log('[FIREBASE] Firebase Admin SDK inicializado com sucesso.');
      } catch (error) {
        console.error(
          '[FIREBASE] Falha ao processar as credenciais do ambiente:',
          error instanceof Error ? error.message : String(error),
        );
      }
    } else if (getApps().length === 0) {
      console.log('[FIREBASE - SIMULADO] Credencial não fornecida; o envio real está desabilitado.');
    }
  }

  async registerDeviceToken(
    dto: RegisterPushTokenDto,
    userId: string,
    tenantId: string,
  ): Promise<{ id: string; platform: string; is_active: boolean }> {
    let deviceToken = await this.pushTokenRepository.findOne({ where: { token: dto.token } });

    if (!deviceToken) {
      deviceToken = this.pushTokenRepository.create({
        token: dto.token,
        user_id: userId,
        tenant_id: tenantId,
        platform: dto.platform || 'web',
        device_label: dto.deviceLabel || null,
        is_active: true,
        last_seen_at: new Date(),
      });
    } else {
      deviceToken.user_id = userId;
      deviceToken.tenant_id = tenantId;
      deviceToken.platform = dto.platform || deviceToken.platform;
      deviceToken.device_label = dto.deviceLabel || deviceToken.device_label;
      deviceToken.is_active = true;
      deviceToken.last_seen_at = new Date();
    }

    const saved = await this.pushTokenRepository.save(deviceToken);
    return { id: saved.id, platform: saved.platform, is_active: saved.is_active };
  }

  async listMyDevices(userId: string, tenantId: string) {
    const devices = await this.pushTokenRepository.find({
      where: { user_id: userId, tenant_id: tenantId },
      order: { last_seen_at: 'DESC' },
    });
    return devices.map((device) => ({
      id: device.id,
      platform: device.platform,
      is_active: device.is_active,
      device_label: device.device_label,
      last_seen_at: device.last_seen_at,
      token_preview: `${device.token.slice(0, 8)}...${device.token.slice(-6)}`,
    }));
  }

  async revokeDeviceToken(deviceId: string, userId: string, tenantId: string) {
    const deviceToken = await this.pushTokenRepository.findOne({
      where: { id: deviceId, user_id: userId, tenant_id: tenantId },
    });

    if (!deviceToken) {
      return { revoked: false };
    }

    deviceToken.is_active = false;
    await this.pushTokenRepository.save(deviceToken);
    return { revoked: true };
  }

  async sendOperationalPush(
    dto: SendOperationalPushDto,
    senderId: string,
    tenantId: string,
  ) {
    const sender = await this.userRepository.findOne({ where: { id: senderId, tenant_id: tenantId } });
    if (!sender) throw new NotFoundException('Remetente não localizado.');
    if (!['recepcao_level_3', 'gerencia_level_2', 'diretoria_level_1'].includes(sender.role)) {
      throw new ForbiddenException('Este perfil não pode enviar Push Operacional.');
    }

    const recipient = await this.userRepository.findOne({
      where: { id: dto.recipientId, tenant_id: tenantId, role: 'corretor_level_3' },
    });
    if (!recipient) throw new NotFoundException('Corretor destinatário não localizado.');

    if (sender.role === 'gerencia_level_2' && recipient.manager_id !== sender.id) {
      throw new ForbiddenException('O Gerente só pode alertar corretores da própria equipe.');
    }

    const presence = await this.presenceRepository.findOne({
      where: {
        broker_id: recipient.id,
        tenant_id: tenantId,
        status: 'online',
        ...(dto.boothId ? { booth_id: dto.boothId } : {}),
      },
    });
    if (!presence) {
      throw new BadRequestException('O corretor precisa estar online para receber um Push Operacional.');
    }

    if (sender.role === 'recepcao_level_3') {
      const assignment = await this.receptionistRepository.findOne({
        where: {
          tenant_id: tenantId,
          booth_id: presence.booth_id,
          receptionist_id: sender.id,
          is_active: true,
        },
      });
      if (!assignment) {
        throw new ForbiddenException('A Recepção só pode alertar corretores do plantão atribuído a ela.');
      }
    }

    const eventId = `operational-${Date.now()}-${recipient.id}`;
    const pushSentCount = await this.sendToUser(
      recipient.id,
      tenantId,
      dto.title,
      dto.body,
      { type: 'operational_push', eventId, boothId: presence.booth_id, presenceId: presence.id },
    );

    await this.auditService.record(
      {
        tenantId,
        actorUserId: sender.id,
        actorRole: sender.role,
        actorEmail: sender.email,
      },
      {
        action: 'OPERATIONAL_PUSH_SENT',
        entityType: 'User',
        entityId: recipient.id,
        success: pushSentCount > 0,
        reason: 'Alerta operacional imediato para corretor online',
        metadata: {
          eventId,
          recipientId: recipient.id,
          recipientName: recipient.nome_guerra,
          boothId: presence.booth_id,
          presenceId: presence.id,
          pushSentCount,
        },
      },
    );

    return {
      message: pushSentCount > 0 ? 'Push Operacional enviado.' : 'Push Operacional registrado, mas nenhum dispositivo ativo confirmou envio.',
      type: 'operational_push',
      eventId,
      recipientId: recipient.id,
      pushSentCount,
    };
  }

  async listOperationalTargets(senderId: string, tenantId: string) {
    const sender = await this.userRepository.findOne({ where: { id: senderId, tenant_id: tenantId } });
    if (!sender || !['recepcao_level_3', 'gerencia_level_2', 'diretoria_level_1'].includes(sender.role)) {
      throw new ForbiddenException('Este perfil não pode consultar destinatários operacionais.');
    }

    const presences = await this.presenceRepository.find({
      where: { tenant_id: tenantId, status: 'online' },
      relations: { broker: true, booth: true },
      order: { check_in_at: 'ASC' },
    });

    let allowedBoothIds: Set<string> | null = null;
    if (sender.role === 'recepcao_level_3') {
      const assignments = await this.receptionistRepository.find({
        where: { tenant_id: tenantId, receptionist_id: sender.id, is_active: true },
      });
      allowedBoothIds = new Set(assignments.map((assignment) => assignment.booth_id));
    }

    return presences
      .filter((presence) => {
        if (sender.role === 'gerencia_level_2' && presence.broker?.manager_id !== sender.id) return false;
        if (allowedBoothIds && !allowedBoothIds.has(presence.booth_id)) return false;
        return true;
      })
      .map((presence) => ({
        recipientId: presence.broker_id,
        nomeGuerra: presence.broker?.nome_guerra || 'Corretor',
        boothId: presence.booth_id,
        boothName: presence.booth?.name || 'Plantão',
        presenceId: presence.id,
        checkInAt: presence.check_in_at,
      }));
  }

  async sendToUser(
    userId: string,
    tenantId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<number> {
    const devices = await this.pushTokenRepository.find({
      where: { user_id: userId, tenant_id: tenantId, is_active: true },
    });

    let sentCount = 0;
    for (const device of devices) {
      if (await this.sendPushNotification(device.token, title, body, data)) {
        sentCount += 1;
      }
    }
    return sentCount;
  }

  async sendToUsers(
    userIds: string[],
    tenantId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<number> {
    const devices = await this.pushTokenRepository.find({
      where: { user_id: In(userIds), tenant_id: tenantId, is_active: true },
    });

    let sentCount = 0;
    for (const device of devices) {
      if (await this.sendPushNotification(device.token, title, body, data)) {
        sentCount += 1;
      }
    }
    return sentCount;
  }

  async sendPushNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<boolean> {
    if (getApps().length === 0) {
      console.log(
        `[FIREBASE - SIMULADO] Push para ${fcmToken.substring(0, 10)}... | ${title}: ${body}`,
      );
      return false;
    }

    try {
      const { getMessaging } = await import('firebase-admin/messaging');
      await getMessaging().send({
        notification: { title, body },
        data: data ? this.stringifyProperties(data) : {},
        token: fcmToken,
      });
      return true;
    } catch (error) {
      console.error(
        '[FIREBASE - ERRO] Falha ao enviar notificação push:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private stringifyProperties(obj: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = String(value);
    }
    return result;
  }
}
