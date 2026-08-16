// src/auth/dto/login.dto.ts
import { IsEmail, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 128)
  passwordHash: string;
}
