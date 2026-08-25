import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  creci?: string;

  @IsOptional()
  @IsString()
  brokerStage?: string;
}
