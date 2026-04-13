import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConversationDocument = Conversation & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Conversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user1: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user2: Types.ObjectId;

  @Prop({ type: Date })
  lastMessageAt: Date;

  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Compound unique index for user1 and user2
ConversationSchema.index({ user1: 1, user2: 1 }, { unique: true });

ConversationSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
