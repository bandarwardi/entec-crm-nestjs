import { IsString, IsEmail, IsOptional, IsNumber, IsEnum, IsDateString, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderType } from './order-type.enum';
import { OrderStatus } from './order-status.enum';

export class CreateCustomerDto {
  @IsString()
  name: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;
}

export class UpdateCustomerDto extends CreateCustomerDto {}

export class CreateDeviceDto {
  @IsString()
  macAddress: string;

  @IsString()
  deviceKey: string;

  @IsString()
  deviceName: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  newCustomer?: CreateCustomerDto;

  @IsOptional()
  @IsString()
  leadAgentId?: string;
  @IsOptional()
  @IsString()
  closerAgentId?: string;

  @IsEnum(OrderType)
  type: OrderType;

  @IsString()
  @IsOptional()
  referrerName?: string;

  @IsNumber()
  amount: number;

  @IsString()
  paymentMethod: string;

  @IsString()
  @IsOptional()
  serverName?: string;

  @IsDateString()
  @IsOptional()
  serverExpiryDate?: string;

  @IsString()
  @IsOptional()
  appType?: string;

  @IsNumber()
  @IsOptional()
  appYears?: number;

  @IsDateString()
  @IsOptional()
  appExpiryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeviceDto)
  @IsOptional()
  devices?: CreateDeviceDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachments?: string[];
}

export class UpdateOrderDto extends CreateOrderDto {}

export class QueryOrdersDto {
  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(OrderType)
  type?: OrderType;
}

export class QueryCustomersDto {
  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  period?: string; // 7days, 30days, ytd, all
}
