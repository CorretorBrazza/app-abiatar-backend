// src/users/user.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn,
  Unique // <-- ADICIONE "Unique" AQUI
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

@Entity('users')
@Unique(['tenant_id', 'nome_guerra']) // <-- ADICIONE ESTA UNICIDADE COMPOSTA
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', nullable: true })
  manager_id: string | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  nome_guerra: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  creci: string | null;

  @Column({
    type: 'enum',
    enum: ['platform_admin_level_0', 'diretoria_level_1', 'gerencia_level_2', 'recepcao_level_3', 'corretor_level_3'],
    default: 'corretor_level_3',
  })
  role: string;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'grace_period'],
    default: 'active',
  })
  status: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'corretor_creci',
    nullable: true,
  })
  broker_stage: 'treinamento' | 'estagiario' | 'corretor_creci' | null;

  @Column({ type: 'boolean', default: false })
  leads_paused: boolean;

  @Column({ type: 'varchar', length: 240, nullable: true })
  leads_pause_reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  removed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  removed_by: string | null;

  @Column({ type: 'timestamp', nullable: true })
  carencia_ends_at: Date | null;

  @Column({ type: 'boolean', default: false })
  must_change_password: boolean;

  @Column({ type: 'timestamp', nullable: true })
  password_reset_expires_at: Date | null;

  @Column({ type: 'int', default: 0 })
  session_version: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}