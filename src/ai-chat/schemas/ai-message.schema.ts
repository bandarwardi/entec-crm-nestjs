import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AiMessageDocument = AiMessage & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class AiMessage {
  @Prop({ type: Types.ObjectId, ref: 'AiConversation', required: true, index: true })
  conversation: Types.ObjectId;

  @Prop({ type: String, enum: ['user', 'model'], required: true })
  role: 'user' | 'model';

  @Prop({ type: String, required: true })
  content: string;
}

export const AiMessageSchema = SchemaFactory.createForClass(AiMessage);

AiMessageSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
