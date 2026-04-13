import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { Customer } from './customer.entity';
import { User } from '../users/user.entity';
import { OrderType } from './order-type.enum';
import { OrderStatus } from './order-status.enum';
import { OrderDevice } from './order-device.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, (customer) => customer.orders)
  customer: Customer;

  @ManyToOne(() => User)
  leadAgent: User; // الموظف الذي جلب العميل

  @ManyToOne(() => User)
  closerAgent: User; // الموظف الذي أغلق الطلب

  @Column({
    type: 'enum',
    enum: OrderType,
    default: OrderType.NEW,
  })
  type: OrderType;

  @Column({ nullable: true })
  referrerName: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column()
  paymentMethod: string; // cash, credit_card, ach_transfer, check, zelle, cash_app, venmo, paypal, apple_pay, google_pay, other

  @Column({ nullable: true })
  serverName: string;

  @Column({ type: 'date', nullable: true })
  serverExpiryDate: Date;

  @Column({ nullable: true })
  appType: string;

  @Column({ type: 'int', nullable: true })
  appYears: number;

  @Column({ type: 'date', nullable: true })
  appExpiryDate: Date;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @OneToMany(() => OrderDevice, (device) => device.order, { cascade: true })
  devices: OrderDevice[];

  @Column('simple-array', { nullable: true })
  attachments: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
