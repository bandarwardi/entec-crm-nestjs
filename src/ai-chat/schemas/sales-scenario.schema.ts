import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SalesScenarioDocument = SalesScenario & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class SalesScenario {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop()
  category: string; // e.g., 'objections', 'follow-up', 'closing'

  @Prop({ required: true })
  prompt: string;

  @Prop()
  icon: string; // PrimeIcons name

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const SalesScenarioSchema = SchemaFactory.createForClass(SalesScenario);

SalesScenarioSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
