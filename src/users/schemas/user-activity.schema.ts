import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserStatus, BreakReason } from '../user-status.enum';

export type UserActivityDocument = UserActivity & Document;

@Schema({ 
  timestamps: { createdAt: 'timestamp', updatedAt: false }, 
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
})
export class UserActivity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: UserStatus, required: true })
  status: UserStatus;

  @Prop({ type: String, enum: BreakReason })
  breakReason: BreakReason;

  @Prop()
  notes: string;

  timestamp: Date;
}

export const UserActivitySchema = SchemaFactory.createForClass(UserActivity);

UserActivitySchema.virtual('id').get(function() {
  return this._id.toHexString();
});
