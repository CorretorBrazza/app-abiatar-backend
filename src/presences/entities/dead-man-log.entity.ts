// src/presences/entities/dead-man-log.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { Presence } from './presence.entity';

@Entity('dead_mans_switch_logs')
export class DeadManLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column()
  presence_id: string;

  @ManyToOne(() => Presence, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'presence_id' })
  presence: Presence;

  @CreateDateColumn({ type: 'timestamp' })
  sent_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  responded_at: Date;

  @Column({
    type: 'enum',
    enum: ['pending', 'valid_gps', 'valid_wifi', 'outside_area', 'no_response'],
    default: 'pending',
  })
  response_status: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude: number;

  @CreateDateColumn()
  created_at: Date;
}