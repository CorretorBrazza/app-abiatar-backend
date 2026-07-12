// src/messages/entities/message-recipient.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { Message } from './message.entity';

@Entity('message_recipients')
export class MessageRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  message_id: string;

  @ManyToOne(() => Message, (message) => message.recipients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @Column()
  recipient_id: string; // ID do corretor ou gerente que recebeu a mensagem [12]

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_id' })
  recipient: User;

  @Column({ type: 'timestamp', nullable: true })
  read_at: Date; // Registra o momento exato em que o destinatário leu o comunicado [13]

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date; // Registra se o usuário excluiu a mensagem de sua caixa de entrada [12]

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}