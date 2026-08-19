// src/messages/dto/create-message.dto.ts
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @Length(1, 150)
  title: string;

  @IsString()
  @Length(1, 10000)
  content: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  @IsIn(['all_users', 'all_brokers', 'all_managers', 'all_receptionists', 'specific_team', 'individual'])
  scope: 'all_users' | 'all_brokers' | 'all_managers' | 'all_receptionists' | 'specific_team' | 'individual';

  @IsOptional()
  @IsUUID()
  targetManagerId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  individualRecipientIds?: string[];
}
