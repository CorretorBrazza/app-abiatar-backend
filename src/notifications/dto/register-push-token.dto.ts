// src/notifications/dto/register-push-token.dto.ts
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @Length(20, 512)
  token: string;

  @IsOptional()
  @IsIn(['web', 'android', 'ios'])
  platform?: string;

  @IsOptional()
  @IsString()
  @Length(1, 150)
  deviceLabel?: string;
}
