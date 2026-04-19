import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
import { LeadStatus } from './lead-status.enum';

export class CreateLeadDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @IsDateString()
  @IsOptional()
  reminderAt?: string;

  @IsString()
  @IsOptional()
  reminderNote?: string;

  @IsString()
  @IsOptional()
  currentPlatform?: string;

  @IsString()
  @IsOptional()
  currentDevice?: string;

  @IsNumber()
  @IsOptional()
  subscriptionAmount?: number;

  @IsNumber()
  @IsOptional()
  subscriptionDuration?: number;
}

export class UpdateLeadDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @IsDateString()
  @IsOptional()
  reminderAt?: string;

  @IsString()
  @IsOptional()
  reminderNote?: string;

  @IsString()
  @IsOptional()
  currentPlatform?: string;

  @IsString()
  @IsOptional()
  currentDevice?: string;

  @IsNumber()
  @IsOptional()
  subscriptionAmount?: number;

  @IsNumber()
  @IsOptional()
  subscriptionDuration?: number;
}

export class QueryLeadsDto {
    @IsOptional()
    page?: number;

    @IsOptional()
    limit?: number;

    @IsOptional()
    search?: string;

    @IsEnum(LeadStatus)
    @IsOptional()
    status?: LeadStatus;

    @IsString()
    @IsOptional()
    state?: string;

    @IsOptional()
    hasReminder?: string;

    @IsString()
    @IsOptional()
    createdBy?: string;
}
