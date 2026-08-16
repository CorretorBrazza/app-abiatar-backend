// src/notifications/notifications.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { PushDeviceToken } from './entities/push-device-token.entity';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @InjectRepository(PushDeviceToken)
    private readonly pushTokenRepository: Repository<PushDeviceToken>,
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
