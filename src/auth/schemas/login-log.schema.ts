import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LoginLogDocument = LoginLog & Document;

@Schema({ 
  timestamps: { createdAt: 'timestamp', updatedAt: false }, 
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
})
export class LoginLog {
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user: Types.ObjectId;

  @Prop()
  email: string;

  @Prop({ required: true })
  status: string; // 'success', 'failure', 'request_pending', 'rejected'

  @Prop()
  ipAddress: string;

  @Prop()
  deviceFingerprint: string;

  @Prop()
  deviceInfo: string;

  @Prop()
  failureReason: string;

  @Prop({ default: 'web' }) // 'web', 'mobile', 'desktop'
  platform: string;

  timestamp: Date;
}

export const LoginLogSchema = SchemaFactory.createForClass(LoginLog);

LoginLogSchema.virtual('id').get(function() {
  return (this as any)._id.toHexString();
});
