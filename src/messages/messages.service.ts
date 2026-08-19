// src/messages/messages.service.ts
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm'; // <-- ADICIONADO "IsNull" AQUI

import { Message } from './entities/message.entity';
import { MessageRecipient } from './entities/message-recipient.entity';
import { User } from '../users/user.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,

    @InjectRepository(MessageRecipient)
    private recipientRepository: Repository<MessageRecipient>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationsService: NotificationsService,
  ) {}

  async listRecipients(tenantId: string, actor: { id: string; role: string }) {
    const where = actor.role === 'gerencia_level_2'
      ? { tenant_id: tenantId, status: 'active', role: 'corretor_level_3', manager_id: actor.id }
      : { tenant_id: tenantId, status: 'active' };
    return this.userRepository.find({
      where,
      select: { id: true, name: true, nome_guerra: true, email: true, role: true, manager_id: true },
      order: { role: 'ASC', nome_guerra: 'ASC' },
    });
  }

  // 1. Envia um comunicado oficial roteando os destinatários de forma dinâmica por escopo [12]
  async createMessage(dto: CreateMessageDto, sender: { id: string; role: string }, tenantId: string) {
    if (!['diretoria_level_1', 'gerencia_level_2', 'platform_admin_level_0'].includes(sender.role)) {
      throw new ForbiddenException('Somente a Diretoria ou a Gerência podem enviar comunicados.');
    }
    const senderId = sender.id;
    // A. Cria e salva o registro master da Mensagem
    const message = this.messageRepository.create({
      tenant_id: tenantId,
      sender_id: senderId,
      title: dto.title,
      content: dto.content,
      is_urgent: dto.isUrgent || false,
    });

    const savedMessage = await this.messageRepository.save(message);

    let recipientUsers: User[] = [];

    if (sender.role === 'gerencia_level_2' && !['individual', 'specific_team'].includes(dto.scope)) {
      throw new ForbiddenException('A Gerência só pode enviar mensagens para Corretores da própria equipe.');
    }

    // B. MOTOR DE ROTEAMENTO: Identifica os destinatários pelo Escopo do DTO [12]
    if (dto.scope === 'all_users') {
      recipientUsers = await this.userRepository.find({ where: { tenant_id: tenantId, status: 'active' } });
    } else if (dto.scope === 'all_brokers') {
      recipientUsers = await this.userRepository.find({
        where: { tenant_id: tenantId, role: 'corretor_level_3' },
      });
    } else if (dto.scope === 'all_managers') {
      recipientUsers = await this.userRepository.find({
        where: { tenant_id: tenantId, role: 'gerencia_level_2', status: 'active' },
      });
    } else if (dto.scope === 'all_receptionists') {
      recipientUsers = await this.userRepository.find({
        where: { tenant_id: tenantId, role: 'recepcao_level_3', status: 'active' },
      });
    } else if (dto.scope === 'specific_team') {
      if (!dto.targetManagerId) {
        throw new BadRequestException('Para enviar a uma equipe específica, o ID do gerente é obrigatório.');
      }
      if (sender.role === 'gerencia_level_2' && dto.targetManagerId !== sender.id) {
        throw new ForbiddenException('A Gerência só pode comunicar a própria equipe.');
      }
      recipientUsers = await this.userRepository.find({
        where: sender.role === 'gerencia_level_2'
          ? { manager_id: sender.id, tenant_id: tenantId, role: 'corretor_level_3', status: 'active' }
          : [
              { id: dto.targetManagerId, tenant_id: tenantId },
              { manager_id: dto.targetManagerId, tenant_id: tenantId }
            ],
      });
    } else if (dto.scope === 'individual') {
      if (!dto.individualRecipientIds || dto.individualRecipientIds.length === 0) {
        throw new BadRequestException('Para envios individuais, pelo menos um ID de destinatário é obrigatório.');
      }
      recipientUsers = await this.userRepository.find({
        where: sender.role === 'gerencia_level_2'
          ? { id: In(dto.individualRecipientIds), tenant_id: tenantId, role: 'corretor_level_3', manager_id: sender.id, status: 'active' }
          : { id: In(dto.individualRecipientIds), tenant_id: tenantId, status: 'active' },
      });
    }

    if (recipientUsers.length === 0) {
      throw new BadRequestException('Nenhum destinatário elegível encontrado para o envio deste comunicado.');
    }

    // C. Salva os registros individuais de recebimento na tabela cruzada para cada usuário
    const recipientEntities = recipientUsers.map((user) =>
      this.recipientRepository.create({
        tenant_id: tenantId,
        message_id: savedMessage.id,
        recipient_id: user.id,
      }),
    );

    await this.recipientRepository.save(recipientEntities);
    const pushSentCount = await this.notificationsService.sendToUsers(
      recipientUsers.map((user) => user.id),
      tenantId,
      dto.title,
      dto.content.slice(0, 240),
      { type: 'message', messageId: savedMessage.id, urgent: dto.isUrgent || false },
    );

    return {
      message: 'Comunicado oficial enviado e roteado com sucesso!',
      messageId: savedMessage.id,
      totalRecipients: recipientUsers.length,
      pushSentCount,
    };
  }

  // 2. Busca a Caixa de Entrada (Inbox) do usuário logado (omitindo mensagens excluídas) [12]
  async getMyInbox(recipientId: string, tenantId: string) {
    return this.recipientRepository.find({
      where: { 
        recipient_id: recipientId, 
        tenant_id: tenantId,
        deleted_at: IsNull() // <-- AJUSTADO PARA O FORMATO CORRETO DO TYPEORM 0.3+
      },
      relations: { 
        message: { sender: true }
      },
      order: { created_at: 'DESC' },
    });
  }

  // 3. Registra a Confirmação de Leitura pelo destinatário [13]
  async markAsRead(messageId: string, recipientId: string, tenantId: string) {
    const recipientRecord = await this.recipientRepository.findOne({
      where: { message_id: messageId, recipient_id: recipientId, tenant_id: tenantId },
    });

    if (!recipientRecord) {
      throw new NotFoundException('Mensagem não localizada na sua caixa de entrada.');
    }

    if (recipientRecord.read_at) {
      return { message: 'Mensagem já marcada como lida anteriormente.' };
    }

    recipientRecord.read_at = new Date();
    await this.recipientRepository.save(recipientRecord);

    return {
      message: 'Leitura confirmada com sucesso!',
      readAt: recipientRecord.read_at,
    };
  }

  // 4. Exclusão individual lógica da mensagem pelo usuário (Soft-delete) [12, 13]
  async deleteMessage(messageId: string, recipientId: string, tenantId: string) {
    const recipientRecord = await this.recipientRepository.findOne({
      where: { message_id: messageId, recipient_id: recipientId, tenant_id: tenantId },
      relations: { message: true }
    });

    if (!recipientRecord) {
      throw new NotFoundException('Mensagem não localizada na sua caixa de entrada.');
    }

    if (recipientRecord.message.is_urgent && !recipientRecord.read_at) {
      throw new BadRequestException('Esta é uma mensagem urgente. Confirme a leitura antes de excluí-la.');
    }

    recipientRecord.deleted_at = new Date();
    await this.recipientRepository.save(recipientRecord);

    return {
      message: 'Mensagem removida da sua caixa de entrada com sucesso.',
    };
  }
}