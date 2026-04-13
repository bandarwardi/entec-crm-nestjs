import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HolidayDocument = Holiday & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Holiday {
  @Prop({ required: true })
  name: string;

  @Prop({ type: Number })
  dayOfWeek: number; // 0=Sun, 5=Fri

  @Prop()
  specificDate: string; // YYYY-MM-DD
}

export const HolidaySchema = SchemaFactory.createForClass(Holiday);

HolidaySchema.virtual('id').get(function() {
  return this._id.toHexString();
});
