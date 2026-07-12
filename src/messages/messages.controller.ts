// src/messages/messages.controller.ts
import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard) // Protege o acesso ao Inbox exigindo Token JWT Bearer ativo
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // 1. Envia um novo comunicado (Diretoria ou Gerência) - CHAMA DIRETAMENTE O SERVIÇO AGORA [12]
  @Post()
  async createMessage(
    @Body() createMessageDto: CreateMessageDto,
    @CurrentUser('sub') senderId: string,
    @TenantId() tenantId: string,
  ) {
    return this.messagesService.createMessage(createMessageDto, senderId, tenantId);
  }

  // 2. Busca a Caixa de Entrada do usuário logado [12]
  @Get('my-inbox')
  async getMyInbox(
    @CurrentUser('sub') recipientId: string,
    @TenantId() tenantId: string,
  ) {
    return this.messagesService.getMyInbox(recipientId, tenantId);
  }

  // 3. Marca um comunicado como lido [13]
  @Patch(':id/read')
  async markAsRead(
    @Param('id') messageId: string,
    @CurrentUser('sub') recipientId: string,
    @TenantId() tenantId: string,
  ) {
    return this.messagesService.markAsRead(messageId, recipientId, tenantId);
  }

  // 4. Remove uma mensagem do Inbox do usuário logado [12, 13]
  @Delete(':id')
  async deleteMessage(
    @Param('id') messageId: string,
    @CurrentUser('sub') recipientId: string,
    @TenantId() tenantId: string,
  ) {
    return this.messagesService.deleteMessage(messageId, recipientId, tenantId);
  }
}