// src/presences/entities/attendance-record.entity.ts
// Registro de TODOS os atendimentos realizados pela Recepção (vez ou simples).
// Usado para análise posterior (Diretoria, Recepção, RH e histórico do próprio corretor).
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { Booth } from '../../booths/entities/booth.entity';

@Index('idx_attendance_records_tenant_broker', ['tenant_id', 'broker_id'])
@Index('idx_attendance_records_tenant_booth', ['tenant_id', 'booth_id'])
@Index('idx_attendance_records_tenant_attended_at', ['tenant_id', 'attended_at'])
@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', nullable: true })
  presence_id: string | null;

  @Column({ type: 'uuid' })
  broker_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broker_id' })
  broker: User;

  @Column({ type: 'uuid' })
  booth_id: string;

  @ManyToOne(() => Booth, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booth_id' })
  booth: Booth;

  @Column({ type: 'varchar', length: 20 })
  tipo: string; // 'vez' | 'agendamento' | 'retorno'

  @Column({ type: 'boolean', default: false })
  in_sequence: boolean; // true = dentro da sequência da roleta; false = fora da janela/sequência

  @Column({ type: 'timestamp' })
  attended_at: Date;

  @Column({ type: 'uuid' })
  attended_by_user_id: string;

  @CreateDateColumn()
  created_at: Date;
}