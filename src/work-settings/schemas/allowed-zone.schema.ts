import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AllowedZoneDocument = AllowedZone & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class AllowedZone {
  @Prop({ required: true })
  name: string;

  @Prop({ type: Number, required: true })
  latitude: number;

  @Prop({ type: Number, required: true })
  longitude: number;

  @Prop({ type: Number, default: 500 })
  radiusMeters: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const AllowedZoneSchema = SchemaFactory.createForClass(AllowedZone);

AllowedZoneSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
