// src/auth/dto/register-tenant.dto.ts
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterTenantDto {
  @IsString()
  @Length(2, 150)
  tenantName: string;

  @IsString()
  @Length(2, 50)
  @Matches(/^[a-z0-9-]+$/)
  tenantSlug: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  secondaryColor?: string;

  @IsString()
  @Length(2, 150)
  userName: string;

  @IsString()
  @Length(2, 50)
  userNomeGuerra: string;

  @IsEmail()
  userEmail: string;

  @IsString()
  @Length(8, 128)
  userPasswordHash: string;
}
