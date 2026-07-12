// src/messages/messages.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { Message } from './entities/message.entity';
import { MessageRecipient } from './entities/message-recipient.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module'; // Importa para habilitar a validação de segurança do JWT

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, MessageRecipient, User]),
    AuthModule, // <-- IMPORTANTE para que as rotas de Inbox fiquem protegidas
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}