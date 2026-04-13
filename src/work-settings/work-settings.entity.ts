import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('work_settings')
export class WorkSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 22 })
  shiftStartHour: number; // 10 PM

  @Column({ default: 0 })
  shiftStartMinute: number;

  @Column({ default: 6 })
  shiftEndHour: number; // 6 AM

  @Column({ default: 0 })
  shiftEndMinute: number;

  @Column({ default: 60 })
  breakDurationMinutes: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  deductionRatePerMinute: number;

  @Column({ default: 'Africa/Cairo' })
  timezone: string;
}
