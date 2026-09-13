// src/auth/dto/login.dto.ts
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 128)
  passwordHash: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  userAgent?: string;
}
