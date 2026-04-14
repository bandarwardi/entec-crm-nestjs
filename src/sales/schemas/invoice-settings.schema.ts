import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InvoiceSettingsDocument = InvoiceSettings & Document;

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class InvoiceSettings {
  @Prop({ default: 'EN TEC' })
  companyName: string;

  @Prop({ default: 'Our word is a guarantee' })
  tagline: string;

  @Prop({ default: 'info@entec.store' })
  email: string;

  @Prop({ default: '+1 (223) 203-0312' })
  phone: string;

  @Prop({ default: 'When you refer a customer, 3 months will be added to your subscription.' })
  referralRule1: string;

  @Prop({ default: 'If you refer 4 customers, a free year will be added to your subscription.' })
  referralRule2: string;

  @Prop({ default: 'In case the screens work at the same time, the broadcast will be interrupted until all the screens are turned off, one screen is returned on the same account and everything returns to work by 100%.\n\nIn case you request to activate another application on the same account with a different device id and device key, the cost of copying the account and activating the application will be $25.\n\nWe are genuinely thrilled to welcome you as a subscriber to the Bob Player app. If you encounter any issues or need guidance, feel free to reach out. We are excited to provide you with a seamless and enriching experience. Best regards, EN TEC Team' })
  noticeText: string;
}

export const InvoiceSettingsSchema = SchemaFactory.createForClass(InvoiceSettings);

InvoiceSettingsSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
