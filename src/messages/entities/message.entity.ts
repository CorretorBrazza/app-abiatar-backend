// src/messages/entities/message.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn,
  OneToMany
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { MessageRecipient } from './message-recipient.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  sender_id: string; // ID do Gerente ou Diretor que enviou a mensagem [12]

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ length: 150 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: false })
  is_urgent: boolean; // Se verdadeiro, exige confirmação de leitura obrigatória [13]

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @OneToMany(() => MessageRecipient, (recipient) => recipient.message, { cascade: true })
  recipients: MessageRecipient[];
}