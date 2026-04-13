import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('holidays')
export class Holiday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  dayOfWeek: number; // 0=Sun, 5=Fri

  @Column({ type: 'date', nullable: true })
  specificDate: string; // YYYY-MM-DD

  @CreateDateColumn()
  createdAt: Date;
}
