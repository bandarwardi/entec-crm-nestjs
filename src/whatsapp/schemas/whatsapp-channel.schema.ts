import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappChannelDocument = WhatsappChannel & Document;

@Schema({ timestamps: true })
export class WhatsappChannel {
  @Prop({ required: true })
  phoneNumber: string;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true, unique: true })
  sessionId: string;

  @Prop({ default: 'disconnected' })
  status: 'connected' | 'disconnected' | 'qr_pending' | 'banned';

  @Prop()
  qrCode: string;

  @Prop()
  lastConnectedAt: Date;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }] })
  assignedAgents: Types.ObjectId[];

  @Prop({ default: false })
  allAgentsAccess: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;
}

export const WhatsappChannelSchema = SchemaFactory.createForClass(WhatsappChannel);
