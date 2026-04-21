import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiSettingsDocument = AiSettings & Document;

@Schema({ timestamps: true })
export class AiSettings {
  @Prop({ required: true, default: 'أنت مساعد ذكي لخدمة العملاء. رد على استفسارات العملاء بناءً على سياق المحادثة وبطريقة مهنية.' })
  systemPrompt: string;

  @Prop({ default: true })
  isEnabled: boolean;

  @Prop({ default: 'gemini-1.5-flash' })
  model: string;
}

export const AiSettingsSchema = SchemaFactory.createForClass(AiSettings);
