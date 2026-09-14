// src/presences/entities/crm-delivery.entity.ts
// Log de ENTREGA dos dados de cliente para o CRM via webhook (best-effort).
// NÃO guarda dados pessoais do cliente (nome/telefone/email) — apenas metadados da entrega.
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { AttendanceRecord } from './attendance-record.entity';

@Index('idx_crm_deliveries_tenant_created', ['tenant_id', 'created_at'])
@Entity('crm_deliveries')
export class CrmDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', nullable: true })
  attendance_id: string | null;

  @ManyToOne(() => AttendanceRecord, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'attendance_id' })
  attendance: AttendanceRecord | null;

  @Column({ type: 'varchar', length: 20 })
  tipo: string; // 'vez' | 'agendamento' | 'retorno'

  @Column({ type: 'varchar', length: 20 })
  status: string; // 'delivered' | 'failed' | 'not_configured'

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'boolean', default: false })
  cliente_informado: boolean; // true = havia dados do cliente (enviado), sem armazená-los

  @Column({ type: 'timestamp', nullable: true })
  delivered_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}