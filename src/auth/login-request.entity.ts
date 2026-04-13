import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('login_requests')
export class LoginRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { eager: true })
  user: User;

  @Column({ type: 'float', nullable: true })
  latitude: number;

  @Column({ type: 'float', nullable: true })
  longitude: number;

  @Column({ default: 'pending' }) // pending, approved, rejected
  status: string;

  @Column({ type: 'text', nullable: true })
  deviceInfo: string;

  @Column({ type: 'text', nullable: true })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;
}
