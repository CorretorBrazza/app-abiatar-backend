import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('weekly_period_report_items')
@Index(['report_id', 'broker_id', 'booth_id'], { unique: true })
export class WeeklyPeriodReportItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  report_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  broker_id: string;

  @Column({ type: 'uuid', nullable: true })
  manager_id: string | null;

  @Column({ type: 'uuid' })
  booth_id: string;

  @Column({ type: 'varchar' })
  broker_name_snapshot: string;

  @Column({ type: 'varchar', nullable: true })
  broker_nome_guerra_snapshot: string | null;

  @Column({ type: 'int', default: 0 })
  valid_periods: number;

  @Column({ type: 'int', default: 0 })
  invalidated_periods: number;

  @Column({ type: 'int', default: 0 })
  accumulated_minutes: number;

  @Column({ type: 'int', default: 0 })
  weighted_periods: number;

  @Column({ type: 'int', default: 0 })
  presence_count: number;

  @Column({ type: 'int', default: 0 })
  absence_count: number;

  @Column({ type: 'boolean', default: false })
  weekend_eligible: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details: Record<string, unknown>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
