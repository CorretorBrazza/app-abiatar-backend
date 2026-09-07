import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TestEmailDto {
  @IsNotEmpty({ message: 'O e-mail de destino é obrigatório.' })
  @IsEmail({}, { message: 'E-mail de destino inválido.' })
  targetEmail: string;

  @IsOptional()
  @IsString()
  subject?: string;
}

export class TestPushDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  scope?: 'first5' | 'all';

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
