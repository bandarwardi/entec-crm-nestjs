import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { OrderType } from '../order-type.enum';
import { OrderStatus } from '../order-status.enum';
import { OrderDevice, OrderDeviceSchema } from './order-device.schema';

export type OrderDocument = Order & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  leadAgent: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  closerAgent: Types.ObjectId;

  @Prop()
  leadAgentName: string;

  @Prop()
  closerAgentName: string;

  @Prop({ type: String, enum: OrderType, default: OrderType.NEW })
  type: OrderType;

  @Prop()
  referrerName: string;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ required: true })
  paymentMethod: string;

  @Prop()
  serverName: string;

  @Prop({ type: Date })
  serverExpiryDate: Date;

  @Prop()
  appType: string;

  @Prop({ type: Number })
  appYears: number;

  @Prop({ type: Date })
  appExpiryDate: Date;

  @Prop()
  notes: string;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.COMPLETED })
  status: OrderStatus;

  @Prop({ type: [OrderDeviceSchema] })
  devices: OrderDevice[];

  @Prop({ type: [String] })
  attachments: string[];

  @Prop()
  invoiceFile: string;

  @Prop({ type: Date })
  subscriptionDate: Date;

  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// For easier count calculation in some views
OrderSchema.virtual('deviceCount').get(function() {
  return this.devices ? this.devices.length : 0;
});
