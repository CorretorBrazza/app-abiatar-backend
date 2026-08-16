// src/users/dto/register-broker.dto.ts
import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterBrokerDto {
  @IsString()
  @Length(20, 128)
  token: string;

  @IsString()
  @Length(2, 150)
  name: string;

  @IsString()
  @Length(2, 50)
  nomeGuerra: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 128)
  passwordHash: string;

  @IsString()
  @Length(2, 20)
  creci: string;
}
