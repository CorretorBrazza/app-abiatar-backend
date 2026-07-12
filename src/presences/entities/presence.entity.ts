// src/presences/entities/presence.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { Booth } from '../../booths/entities/booth.entity';

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

  @ManyToOne(() => Booth, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booth_id' })
  booth: Booth;

  @Column({ type: 'timestamp', nullable: true }) // <-- Usamos @Column tradicional
  check_in_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  check_out_at: Date;

  @Column({ default: 0 })
  accumulated_minutes: number; // Minutos validados acumulados neste turno

  @Column({
    type: 'enum',
    enum: ['online', 'paused', 'absent', 'completed', 'invalidated'],
    default: 'online',
  })
  status: string;

  @Column({ default: 1 })
  period_weight: number; // Peso do período (ex: 1 para turnos normais, 2 para feriados) [9]

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}