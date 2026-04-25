import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DesktopUserDocument = DesktopUser & Document;

@Schema({ timestamps: true })
export class DesktopUser {
  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, ref: 'User', required: false })
  linkedUser: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const DesktopUserSchema = SchemaFactory.createForClass(DesktopUser);
