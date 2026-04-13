import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum MediaType {
  IMAGE = 'image',
  FILE = 'file',
}

export type MessageDocument = Message & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversation: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop()
  content: string;

  @Prop()
  mediaUrl: string;

  @Prop({ type: String, enum: MediaType })
  mediaType: MediaType;

  @Prop()
  originalFileName: string;

  @Prop({ default: false })
  isRead: boolean;

  id: string;
  createdAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
