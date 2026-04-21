import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { LeadStatus } from '../lead-status.enum';

export type LeadDocument = Lead & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Lead {
  @Prop()
  name: string;

  @Prop({ required: true })
  phone: string;

  @Prop()
  state: string;

  @Prop()
  notes: string;

  @Prop()
  currentPlatform: string;

  @Prop()
  currentDevice: string;

  @Prop()
  subscriptionAmount: number;

  @Prop()
  subscriptionDuration: number;

  @Prop({ type: String, enum: LeadStatus, default: LeadStatus.NEW })
  status: LeadStatus;

  @Prop({ type: Date })
  reminderAt: Date;

  @Prop({ type: Date })
  lastMessageAt: Date;

  @Prop()
  profilePicUrl: string;

  @Prop({ default: false })
  isOnline: boolean;

  @Prop()
  reminderNote: string;

  @Prop({ default: false })
  reminderRead: boolean;

  @Prop({ default: false })
  reminderNotified: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: false })
  isGroup: boolean;

  @Prop()
  groupJid: string;

  @Prop({ default: 0 })
  unreadCount: number;

  @Prop({ default: false })
  isArchived: boolean;

  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

LeadSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
