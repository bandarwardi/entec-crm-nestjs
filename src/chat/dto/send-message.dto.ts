import { IsString, IsOptional, IsInt } from 'class-validator';

export class SendMessageDto {
  @IsInt()
  conversationId: number;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  mediaUrl?: string;

  @IsString()
  @IsOptional()
  mediaType?: 'image' | 'file';

  @IsString()
  @IsOptional()
  originalFileName?: string;
}
