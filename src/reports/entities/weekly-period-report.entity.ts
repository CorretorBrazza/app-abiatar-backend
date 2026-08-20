import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('weekly_period_reports')
@Index(['tenant_id', 'week_start'], { unique: true })
export class WeeklyPeriodReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'date' })
  week_start: string;

  @Column({ type: 'date' })
  week_end: string;

  @Column({ type: 'varchar', default: 'in_progress' })
  status: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  rules_snapshot: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  totals: Record<string, unknown>;

  @Column({ type: 'timestamp', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  closed_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
