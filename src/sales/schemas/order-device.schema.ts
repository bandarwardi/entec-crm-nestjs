import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: true, timestamps: { createdAt: true, updatedAt: false } })
export class OrderDevice {
  @Prop({ required: true })
  macAddress: string;

  @Prop({ required: true })
  deviceKey: string;

  @Prop({ required: true })
  deviceName: string;

  @Prop()
  username: string;
}

export const OrderDeviceSchema = SchemaFactory.createForClass(OrderDevice);
