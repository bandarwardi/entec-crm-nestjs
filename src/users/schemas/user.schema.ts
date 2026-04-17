import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../roles.enum';
import { UserStatus } from '../user-status.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  avatar: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, enum: Role, default: Role.AGENT })
  role: Role;

  @Prop({ type: String, enum: UserStatus, default: UserStatus.OFFLINE })
  currentStatus: UserStatus;

  @Prop({ type: [String], default: [] })
  trustedDevices: string[];

  @Prop({ type: Date })
  lastStatusChange: Date;

  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Add virtual 'id' to map '_id'
UserSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
