import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LoginChallengeDocument = LoginChallenge & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class LoginChallenge {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, unique: true })
  challengeToken: string;

  @Prop({ default: 'pending' }) // pending, approved, rejected, expired
  status: string;

  @Prop()
  deviceFingerprint: string;

  @Prop()
  ipAddress: string;

  @Prop()
  browserInfo: string;

  @Prop()
  approvedLatitude: number;

  @Prop()
  approvedLongitude: number;

  @Prop()
  approvedZoneName: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop()
  jwtToken: string;
}

export const LoginChallengeSchema = SchemaFactory.createForClass(LoginChallenge);

LoginChallengeSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
