import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappTemplateDocument = WhatsappTemplate & Document;

@Schema({ timestamps: true })
export class WhatsappTemplate {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;
}

export const WhatsappTemplateSchema = SchemaFactory.createForClass(WhatsappTemplate);
