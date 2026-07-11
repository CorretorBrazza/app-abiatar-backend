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

  @Column()
  manager_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'manager_id' })
  manager: User;

  @Column({ length: 100, unique: true })
  token: string;

  @Column({ type: 'timestamp' })
  valid_until: Date;

  @Column({ default: false })
  is_used: boolean; // Usado para links de uso único (opcional)

  @CreateDateColumn()
  created_at: Date;
}