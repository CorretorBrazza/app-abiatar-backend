import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateManagerDto {
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

  @IsOptional()
  @IsString()
  creci?: string;

  @IsOptional()
  @IsString()
  brokerStage?: string;
}
