// src/users/user.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', nullable: true })
  manager_id: string;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 50, unique: true })
  nome_guerra: string;

  @Column({ length: 100, unique: true })
  email: string;

  @Column({ length: 255 })
  password_hash: string;

  @Column({ length: 20, nullable: true })
  creci: string;

  @Column({
    type: 'enum',
    enum: ['diretoria_level_1', 'gerencia_level_2', 'corretor_level_3'],
    default: 'corretor_level_3',
  })
  role: string;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'grace_period'],
    default: 'active',
  })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  carencia_ends_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
