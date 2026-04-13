import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WorkSettingsDocument = WorkSettings & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class WorkSettings {
  @Prop({ default: 22 })
  shiftStartHour: number; // 10 PM

  @Prop({ default: 0 })
  shiftStartMinute: number;

  @Prop({ default: 6 })
  shiftEndHour: number; // 6 AM

  @Prop({ default: 0 })
  shiftEndMinute: number;

  @Prop({ default: 60 })
  breakDurationMinutes: number;

  @Prop({ type: Number, default: 0 })
  deductionRatePerMinute: number;

  @Prop({ default: 'Africa/Cairo' })
  timezone: string;
}

export const WorkSettingsSchema = SchemaFactory.createForClass(WorkSettings);

WorkSettingsSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
