import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AiConversationDocument = AiConversation & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class AiConversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ nullable: true })
  title: string;
}

export const AiConversationSchema = SchemaFactory.createForClass(AiConversation);

AiConversationSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
