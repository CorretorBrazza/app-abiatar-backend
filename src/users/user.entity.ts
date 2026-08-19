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

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'uuid', nullable: true })
  manager_id: string | null;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 50 }) // <-- REMOVA O "unique: true" DAQUI
  nome_guerra: string;

  @Column({ length: 100, unique: true }) // O e-mail continua único globalmente
  email: string;

  @Column({ length: 255 })
  password_hash: string;

  @Column({ length: 20, nullable: true })
  creci: string;

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

  @Column({ default: false })
  leads_paused: boolean;

  @Column({ type: 'varchar', length: 240, nullable: true })
  leads_pause_reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  removed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  removed_by: string | null;

  @Column({ type: 'timestamp', nullable: true })
  carencia_ends_at: Date | null;

  @Column({ default: false })
  must_change_password: boolean;

  @Column({ type: 'timestamp', nullable: true })
  password_reset_expires_at: Date | null;

  @Column({ default: 0 })
  session_version: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}