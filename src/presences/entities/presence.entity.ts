// src/presences/entities/presence.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn,
  Index
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { Booth } from '../../booths/entities/booth.entity';

@Index('uq_presences_broker_active', ['broker_id', 'tenant_id'], {
  unique: true,
  where: `status = 'online'`,
})
@Entity('presences')
export class Presence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  broker_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broker_id' })
  broker: User;

  @Column()
  booth_id: string;

  @Column({ type: 'uuid', nullable: true })
  rule_set_id: string | null;

  @Column({ type: 'int', default: 120 })
  minimum_period_minutes: number;

  @Column({ type: 'int', default: 1 })
  period_weight: number;

  @Column({ type: 'int', default: 20 })
  minimum_monthly_periods: number;

  @ManyToOne(() => Booth, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booth_id' })
  booth: Booth;

  @Column({ type: 'timestamp', nullable: true })
  check_in_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  check_out_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_confirmed_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  next_confirmation_at: Date | null;

  @Column({ default: 0 })
  accumulated_minutes: number; // Minutos validados acumulados neste turno

  @Column({ type: 'varchar', length: 50, nullable: true })
  roleta_name: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  roleta_entry_type: string | null; // 'pontual' | 'pos_barra'

  @Column({ type: 'int', nullable: true })
  roleta_position: number | null; // Ordem sorteada ou posição no pós-barra

  @Column({ type: 'timestamp', nullable: true })
  validation_starts_at: Date | null; // Horário a partir do qual contam os 120 min

  @Column({ type: 'timestamp', nullable: true })
  attended_at: Date | null; // Atendimento realizado pela Recepção (Plano B)

  @Column({ type: 'uuid', nullable: true })
  attended_by_user_id: string | null; // Registro de quem realizou o atendimento

  @Column({
    type: 'enum',
    enum: ['online', 'paused', 'absent', 'completed', 'invalidated'],
    default: 'online',
  })
  status: string;


  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}