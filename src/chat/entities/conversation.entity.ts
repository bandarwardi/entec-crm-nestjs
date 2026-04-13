import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/user.entity';
import { Message } from './message.entity';

@Entity('conversations')
@Index(['user1Id', 'user2Id'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user1Id: number;

  @Column()
  user2Id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user1Id' })
  user1: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user2Id' })
  user2: User;

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];

  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
