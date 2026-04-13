import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/user.entity';

export enum MediaType {
  IMAGE = 'image',
  FILE = 'file',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  conversationId: number;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column()
  senderId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'senderId' })
  sender: User;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ nullable: true })
  mediaUrl: string;

  @Column({ type: 'enum', enum: MediaType, nullable: true })
  mediaType: MediaType;

  @Column({ nullable: true })
  originalFileName: string;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  @Index()
  createdAt: Date;
}
