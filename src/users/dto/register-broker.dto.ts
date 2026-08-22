// src/users/dto/register-broker.dto.ts
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RegisterBrokerDto {
  @IsOptional()
  @IsString()
  @Length(10, 128)
  token?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @IsOptional()
  @IsIn(['treinamento', 'estagiario', 'corretor_creci'])
  brokerStage?: 'treinamento' | 'estagiario' | 'corretor_creci';

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
  @Length(1, 30)
  creci?: string;
}

