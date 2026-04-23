import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LoginRequestDocument = LoginRequest & Document;

@Schema({ 
  timestamps: { createdAt: true, updatedAt: false }, 
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
})
export class LoginRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Number })
  latitude: number;

  @Prop({ type: Number })
  longitude: number;

  @Prop({ default: 'pending' }) // pending, approved, rejected
  status: string;

  @Prop()
  deviceFingerprint: string;

  @Prop()
  deviceInfo: string;

  @Prop()
  ipAddress: string;
}

export const LoginRequestSchema = SchemaFactory.createForClass(LoginRequest);

LoginRequestSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
