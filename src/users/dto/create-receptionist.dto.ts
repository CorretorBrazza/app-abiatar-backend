import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateReceptionistDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  nomeGuerra: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  passwordHash: string;
}
