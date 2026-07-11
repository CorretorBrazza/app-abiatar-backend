// src/booths/entities/booth-wifi.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  JoinColumn 
} from 'typeorm';
import { Booth } from './booth.entity';

@Entity('booth_wifis')
export class BoothWifi {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenant_id: string;

  @Column()
  booth_id: string;

  @ManyToOne(() => Booth, (booth) => booth.wifis, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booth_id' })
  booth: Booth;

  @Column({ length: 100 })
  ssid: string;

  @CreateDateColumn()
  created_at: Date;
}