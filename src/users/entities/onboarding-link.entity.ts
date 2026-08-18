// src/users/entities/onboarding-link.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../user.entity';

@Entity('manager_onboarding_links')
export class OnboardingLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', nullable: true })
  manager_id: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User | null;

  @Column({ type: 'uuid', nullable: true })
  inviter_id: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'inviter_id' })
  inviter: User | null;

  @Column({ type: 'varchar', length: 24, default: 'corretor_level_3' })
  invited_role: 'gerencia_level_2' | 'corretor_level_3';

  @Column({ length: 100, unique: true })
  token: string;

  @Column({ type: 'timestamp' })
  valid_until: Date;

  @Column({ default: false })
  is_used: boolean; // Usado para links de uso único (opcional)

  @CreateDateColumn()
  created_at: Date;
}