import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
@Index(['tenant_id', 'created_at'])
@Index(['actor_user_id', 'created_at'])
@Index(['action', 'created_at'])
@Index(['entity_type', 'entity_id'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  booth_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  actor_user_id: string | null;

  @Column({ length: 80, nullable: true })
  actor_role: string | null;

  @Column({ length: 160, nullable: true })
  actor_email_snapshot: string | null;

  @Column({ length: 120, nullable: true })
  session_id: string | null;

  @Column({ length: 120, nullable: true })
  request_id: string | null;

  @Column({ length: 120 })
  action: string;

  @Column({ length: 80, nullable: true })
  entity_type: string | null;

  @Column({ length: 120, nullable: true })
  entity_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before_data: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after_data: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'inet', nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @Column({ default: true })
  success: boolean;

  @Column({ length: 120, nullable: true })
  error_code: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
