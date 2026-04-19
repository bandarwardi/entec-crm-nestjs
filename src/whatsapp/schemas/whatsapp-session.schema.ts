import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappSessionDocument = WhatsappSession & Document;

@Schema({ timestamps: true })
export class WhatsappSession {
  @Prop({ type: Types.ObjectId, ref: 'WhatsappChannel', required: true, unique: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  sessionId: string;

  @Prop({ type: Object, required: true })
  data: any; // Baileys auth data
}

export const WhatsappSessionSchema = SchemaFactory.createForClass(WhatsappSession);
