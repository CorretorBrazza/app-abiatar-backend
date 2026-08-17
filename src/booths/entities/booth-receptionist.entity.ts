import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('booth_receptionists')
@Unique(['booth_id', 'receptionist_id'])
@Index(['tenant_id', 'booth_id'])
@Index(['tenant_id', 'receptionist_id'])
export class BoothReceptionist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  booth_id: string;

  @Column({ type: 'uuid' })
  receptionist_id: string;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
