import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class RegisterManagerDto {
  @IsString()
  @Length(16, 128)
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
  @MinLength(8)
  passwordHash: string;
}
