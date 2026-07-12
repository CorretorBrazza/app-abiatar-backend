// src/notifications/notifications.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { initializeApp, getApps, cert } from 'firebase-admin/app'; // <-- IMPORTAMOS "cert" DIRETAMENTE AQUI

@Injectable()
export class NotificationsService implements OnModuleInit {
  onModuleInit() {
    // Inicializa o Firebase Admin SDK usando a variável de ambiente segura no .env
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountVar && getApps().length === 0) {
      try {
        const serviceAccount = JSON.parse(serviceAccountVar);
        initializeApp({
          credential: cert(serviceAccount), // <-- UTILIZAMOS "cert" DIRETAMENTE AQUI
        });
        console.log('[FIREBASE] Firebase Admin SDK inicializado com sucesso de forma nativa.');
      } catch (error) {
        console.error('[FIREBASE] Falha ao processar as credenciais do .env:', error.message);
      }
    } else if (getApps().length === 0) {
      // Se não houver chaves de produção ainda, o sistema roda em modo simulado sem quebrar o servidor
      console.log('[FIREBASE - SIMULADO] Chave do Firebase não fornecida no .env. Ignorando inicialização real...');
    }
  }

  // Envia uma notificação push individual para o dispositivo de um corretor ou gerente [18]
  async sendPushNotification(fcmToken: string, title: string, body: string, data?: any): Promise<boolean> {
    if (getApps().length === 0) {
      // Se estiver em ambiente local de testes sem credenciais reais do Firebase, simula o envio no log
      console.log(`[FIREBASE - SIMULADO] Push enviado para o token: ${fcmToken.substring(0, 10)}... | Título: ${title} | Corpo: ${body}`);
      return true;
    }

    try {
      const message = {
        notification: { title, body },
        data: data ? this.stringifyProperties(data) : {},
        token: fcmToken,
      };

      // Carrega o módulo de mensageria sob demanda de forma segura e assíncrona
      const { getMessaging } = await import('firebase-admin/messaging');
      await getMessaging().send(message);
      return true;
    } catch (error) {
      console.error('[FIREBASE - ERRO] Falha ao enviar notificação push:', error.message);
      return false;
    }
  }

  // Método auxiliar para converter qualquer objeto em string (exigência técnica do FCM do Google)
  private stringifyProperties(obj: any): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = String(obj[key]);
      }
    }
    return result;
  }
}