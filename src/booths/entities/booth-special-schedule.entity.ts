import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { Booth } from './booth.entity';
import { User } from '../../users/user.entity';

@Entity('booth_special_schedules')
@Index(['tenant_id', 'booth_id'])
export class BoothSpecialSchedule {
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

  @Column({ type: 'varchar', length: 20, default: 'recurring' })
  scope: 'recurring' | 'one_off'; // 'recurring' (todos) ou 'one_off' (somente o próximo)

  @Column({ type: 'int', nullable: true })
  day_of_week: number | null; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado

  @Column({ type: 'varchar', length: 10, nullable: true })
  specific_date: string | null; // YYYY-MM-DD (para 'one_off')

  @Column({ type: 'varchar', length: 150 })
  description: string; // Ex: "Abertura Shopping aos Domingos"

  @Column({ type: 'varchar', length: 5, default: '12:00' })
  roleta_time: string; // HH:MM

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
