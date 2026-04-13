import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import { User } from './user.entity';
import { UserStatus, BreakReason } from './user-status.enum';

@Entity('user_activities')
export class UserActivity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.activities)
  user: User;

  @Column({
    type: 'enum',
    enum: UserStatus,
  })
  status: UserStatus;

  @Column({
    type: 'enum',
    enum: BreakReason,
    nullable: true,
  })
  breakReason: BreakReason;

  @Column({ nullable: true })
  notes: string;

  @Index()
  @CreateDateColumn()
  timestamp: Date;
}
