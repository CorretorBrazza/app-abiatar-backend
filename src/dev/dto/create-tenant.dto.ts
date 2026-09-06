import { IsNotEmpty, IsString, IsEmail, IsOptional, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsNotEmpty({ message: 'O nome da empresa é obrigatório.' })
  @IsString()
  @Length(2, 150)
  name: string;

  @IsNotEmpty({ message: 'O subdomínio/slug é obrigatório.' })
  @IsString()
  @Length(2, 50)
  @Matches(/^[a-z0-9-]+$/, { message: 'O slug deve conter apenas letras minúsculas, números e hífens.' })
  slug: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsNotEmpty({ message: 'O nome do administrador é obrigatório.' })
  @IsString()
  adminName: string;

  @IsNotEmpty({ message: 'O nome de guerra do administrador é obrigatório.' })
  @IsString()
  adminNomeGuerra: string;

  @IsNotEmpty({ message: 'O e-mail do administrador é obrigatório.' })
  @IsEmail({}, { message: 'E-mail do administrador inválido.' })
  adminEmail: string;

  @IsNotEmpty({ message: 'A senha inicial é obrigatória.' })
  @IsString()
  @Length(6, 50, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  adminPassword: string;
}
