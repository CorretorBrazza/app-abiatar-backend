// src/tenants/tenant.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  OneToMany 
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 50, unique: true })
  slug: string;

  @Column({ length: 255, nullable: true })
  logo_url: string;

  @Column({ length: 7, default: '#E31C1C' })
  primary_color: string;

  @Column({ length: 7, default: '#000000' })
  secondary_color: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings: Record<string, any>;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'suspended', 'trial'],
    default: 'trial',
  })
  status_assinatura: string;

  @Column({ type: 'date', nullable: true })
  data_vencimento: Date;

  @Column({ default: 10 })
  limite_plantoes: number;

  @Column({ default: 300 })
  limite_corretores: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => User, (user) => user.tenant)
  users: User[];
}