// src/booths/entities/booth.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn, 
  OneToMany 
} from 'typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { BoothWifi } from './booth-wifi.entity';

@Entity('booths')
export class Booth {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255 })
  address: string;

  @Column({ type: 'decimal', precision: 10, scale: 8 })
  latitude: number;

  @Column({ type: 'decimal', precision: 11, scale: 8 })
  longitude: number;

  @Column({ default: 100 })
  gps_radius: number; // Raio em metros

  @Column({ default: 2 })
  min_brokers_required: number; // Cobertura mínima exigida para o plantão [6]

  @Column({ type: 'uuid', nullable: true })
  manager_id: string | null;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  lifecycle_status: 'draft' | 'published' | 'paused' | 'archived';

  @Column({ type: 'timestamp', nullable: true })
  published_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  published_by: string | null; // <-- AJUSTADO PARA "string | null" para tipagem estrita

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'published_by' })
  publisher: User | null; // <-- AJUSTADO PARA "User | null" para tipagem estrita

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => BoothWifi, (wifi) => wifi.booth, { cascade: true })
  wifis: BoothWifi[];
}