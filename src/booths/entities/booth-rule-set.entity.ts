import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { Booth } from './booth.entity';
import { User } from '../../users/user.entity';

@Entity('booth_rule_sets')
export class BoothRuleSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid' })
  booth_id: string;

  @ManyToOne(() => Booth, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booth_id' })
  booth: Booth;

  @Column({ type: 'int' })
  version: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 120 })
  minimum_period_minutes: number;

  @Column({ type: 'int', default: 1 })
  period_weight: number;

  @Column({ type: 'int', default: 5 })
  saturday_required_periods: number;

  @Column({ type: 'int', default: 6 })
  sunday_required_periods: number;

  @Column({ type: 'time', nullable: true })
  opening_time: string | null;

  @Column({ type: 'time', nullable: true })
  closing_time: string | null;

  @Column({ type: 'int', default: 0 })
  checkin_tolerance_minutes: number;

  @Column({ type: 'int', default: 0 })
  checkout_tolerance_minutes: number;

  @Column({ type: 'int', default: 30 })
  ping_interval_minutes: number;

  @Column({ type: 'int', default: 5 })
  ping_response_deadline_minutes: number;

  @Column({ type: 'int', default: 2 })
  minimum_brokers_required: number;

  @Column({ type: 'int', default: 100 })
  gps_radius_meters: number;

  @Column({ default: true })
  weekend_enabled: boolean;

  @Column({ type: 'int', default: 20 })
  minimum_monthly_periods: number;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
