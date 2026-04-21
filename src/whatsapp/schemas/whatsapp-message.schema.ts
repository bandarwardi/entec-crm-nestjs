import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappMessageDocument = WhatsappMessage & Document;

@Schema({ timestamps: true })
export class WhatsappMessage {
  @Prop({ type: Types.ObjectId, ref: 'WhatsappChannel', required: true })
  channelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadId: Types.ObjectId;

  @Prop({ required: true })
  externalNumber: string;

  @Prop({ required: true, enum: ['inbound', 'outbound'] })
  direction: 'inbound' | 'outbound';

  @Prop({ default: '' })
  content: string;

  @Prop({ default: 'text' })
  messageType: string;

  @Prop({ unique: true })
  waMessageId: string;

  @Prop({ default: 'sent', enum: ['pending', 'sent', 'delivered', 'read', 'failed'] })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  sentByAgent: Types.ObjectId;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ default: false })
  unresolvedLid: boolean;

  @Prop()
  lidJid: string;

  @Prop()
  groupJid: string;

  @Prop()
  senderJid: string;

  @Prop()
  senderName: string;

  @Prop()
  quotedMessageId: string;

  @Prop()
  quotedContent: string;

  @Prop()
  quotedMessageType: string;
}

export const WhatsappMessageSchema = SchemaFactory.createForClass(WhatsappMessage);
// Index for fast message history retrieval
WhatsappMessageSchema.index({ channelId: 1, externalNumber: 1, timestamp: -1 });
WhatsappMessageSchema.index({ leadId: 1 });
