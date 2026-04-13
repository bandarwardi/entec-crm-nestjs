import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne } from 'typeorm';
import { Order } from './order.entity';

@Entity('order_devices')
export class OrderDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, (order) => order.devices, { onDelete: 'CASCADE' })
  order: Order;

  @Column()
  macAddress: string;

  @Column()
  deviceKey: string;

  @Column()
  deviceName: string;

  @CreateDateColumn()
  createdAt: Date;
}
